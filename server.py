"""
Local Flask server for loan prediction inference.

Supports two model formats (checked in order):
  1. ONNX  — imputer.onnx + lgbm_model.onnx + metadata.pkl in models/
  2. Pickle — single .pkl bundle in models/

Falls back to mock predictions if no model files are found.

"""

import os
import pickle
import glob

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

app = Flask(__name__, static_folder=".", static_url_path="")
# Enable CORS for all routes and origins
CORS(app, resources={r"/*": {"origins": "*"}})


MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Global model state
inference_mode = None  # "onnx" | "pickle" | "mock"
bundle = None
imputer_session = None
model_session = None
metadata = None
explainer = None


def load_models():
    """Load model files from the local models/ directory."""
    global inference_mode, bundle, imputer_session, model_session, metadata, explainer

    # --- Fallback to pickle bundle ---
    pkl_files = glob.glob(os.path.join(MODELS_DIR, "*.pkl"))
    pkl_files = [p for p in pkl_files if os.path.basename(p) != "metadata.pkl"]

    if pkl_files:
        bundle_path = pkl_files[0]
        print(f"   Loading pickle bundle: {bundle_path}")

        with open(bundle_path, "rb") as f:
            bundle = pickle.load(f)

        expected_keys = ["model", "imputer", "feature_cols", "threshold"]
        missing = [k for k in expected_keys if k not in bundle]
        if missing:
            inference_mode = "mock"
            return

        inference_mode = "pickle"
        
        if SHAP_AVAILABLE:
            try:
                # Use TreeExplainer for LightGBM/XGBoost/RandomForest
                explainer = shap.TreeExplainer(bundle["model"])
                print("✅ SHAP TreeExplainer initialized.")
            except Exception as e:
                print(f"⚠️  Could not initialize SHAP TreeExplainer: {e}")
                try:
                    # Fallback to generic Explainer for broader model compatibility
                    explainer = shap.Explainer(bundle["model"])
                    print("✅ SHAP generic Explainer initialized.")
                except:
                    print("⚠️  SHAP initialization failed completely.")
        
        return

    inference_mode = "mock"


def _extract_shap_values_for_default(shap_output):
    """Normalize SHAP output to 1D values for class 1 (Default)."""
    values = np.array(shap_output)

    # Most common binary classification outputs:
    # (n_samples, n_features) OR (n_samples, n_features, n_classes)
    if values.ndim == 3:
        return values[0, :, 1]
    if values.ndim == 2:
        return values[0]
    if values.ndim == 1:
        return values

    raise ValueError(f"Unexpected SHAP values shape: {values.shape}")


def get_explanations(input_imputed, feature_names):
    """Calculate SHAP values and return top contributors."""
    if not SHAP_AVAILABLE or explainer is None:
        return None

    try:
        # Legacy SHAP explainers often expose shap_values, newer ones return Explanation via __call__.
        values = None
        if hasattr(explainer, "shap_values"):
            shap_values = explainer.shap_values(input_imputed)
            if isinstance(shap_values, list):
                values = np.array(shap_values[1][0])
            else:
                values = _extract_shap_values_for_default(shap_values)

        if values is None:
            explanation = explainer(input_imputed)
            values = _extract_shap_values_for_default(explanation.values)

        # Create list of (feature, value) pairs
        contributions = []
        for i, val in enumerate(values):
            contributions.append({
                "feature": feature_names[i],
                "value": float(val)
            })
        
        # Sort by absolute impact
        contributions.sort(key=lambda x: abs(x["value"]), reverse=True)
        return contributions[:5] # Top 5 contributors
    except Exception as e:
        print(f"Error calculating SHAP: {e}")
        return None


def predict_onnx(features):
    """Run inference using ONNX runtime."""
    ordered = [features[col] for col in metadata["feature_columns"]]
    input_array = np.array([ordered], dtype=np.float32)

    imputer_input = {imputer_session.get_inputs()[0].name: input_array}
    imputed_array = imputer_session.run(None, imputer_input)[0]

    model_input = {model_session.get_inputs()[0].name: imputed_array.astype(np.float32)}
    outputs = model_session.run(None, model_input)

    proba_default = float(outputs[1][0][1])
    threshold = metadata["threshold"]
    prediction = int(proba_default >= threshold)

    # Mock explanations for ONNX since full SHAP setup for ONNX is heavy
    mock_explanations = [
        {"feature": metadata["feature_columns"][0], "value": 0.15},
        {"feature": metadata["feature_columns"][1], "value": -0.1},
        {"feature": metadata["feature_columns"][2], "value": 0.05}
    ]

    return {
        "prediction": prediction,
        "probability": round(proba_default, 4),
        "threshold_used": threshold,
        "label": "Default" if prediction == 1 else "No Default",
        "explanations": mock_explanations
    }


def predict_pickle(features):
    """Run inference using the pickle bundle."""
    feature_names = bundle["feature_cols"]
    ordered = [features[col] for col in feature_names]
    input_array = np.array([ordered], dtype=np.float32)
    input_imputed = bundle["imputer"].transform(input_array)

    proba = bundle["model"].predict_proba(input_imputed)[0][1]
    threshold = 0.2
    prediction = int(proba >= threshold)
    
    explanations = get_explanations(input_imputed, feature_names)

    return {
        "prediction": prediction,
        "probability": round(float(proba), 4),
        "threshold_used": threshold,
        "label": "Default" if prediction == 1 else "No Default",
        "explanations": explanations
    }


@app.route("/predict", methods=["POST"])
def predict():
    """Run inference on the submitted features."""
    try:
        body = request.get_json()
        features = body.get("features")

        if not features:
            return jsonify({"error": "Missing 'features' in request body"}), 400
        
        result = predict_pickle(features)
        
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    """Serve the frontend."""
    return send_from_directory(".", "index.html")


if __name__ == "__main__":
    load_models()
    print(f"\n🚀 Loan Predictor API running at http://localhost:5002")
    app.run(host="0.0.0.0", port=5002, debug=True)
