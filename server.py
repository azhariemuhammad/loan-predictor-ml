"""
Local Flask server for loan prediction inference.

Loads a pickle bundle (model, imputer, feature_cols, threshold) from models/
and exposes a /predict endpoint for real-time inference with SHAP explanations.
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
bundle = None
explainer = None


def load_models():
    """Load the pickle bundle and initialise the SHAP explainer."""
    global bundle, explainer

    pkl_files = glob.glob(os.path.join(MODELS_DIR, "*.pkl"))
    pkl_files = [p for p in pkl_files if os.path.basename(p) != "metadata.pkl"]

    if not pkl_files:
        raise FileNotFoundError(
            f"No .pkl model bundle found in {MODELS_DIR}. "
            "Please place a valid model bundle in the models/ directory."
        )

    bundle_path = pkl_files[0]
    print(f"   Loading pickle bundle: {bundle_path}")

    with open(bundle_path, "rb") as f:
        bundle = pickle.load(f)

    expected_keys = ["model", "imputer", "feature_cols"]
    missing = [k for k in expected_keys if k not in bundle]
    if missing:
        raise KeyError(
            f"Pickle bundle is missing required keys: {missing}. "
            f"Expected keys: {expected_keys}"
        )

    if SHAP_AVAILABLE:
        model = bundle["model"]
        n_features = len(bundle["feature_cols"])

        # Build a synthetic background dataset from the imputer's learned statistics.
        # This avoids needing to bundle training data while giving SHAP a
        # reasonable baseline for computing feature contributions.
        background = None
        imputer = bundle["imputer"]
        if hasattr(imputer, "statistics_"):
            background = np.tile(
                imputer.statistics_.astype(np.float32), (50, 1)
            )

        try:
            # Use TreeExplainer for tree-based models (LightGBM/XGBoost/RF)
            explainer = shap.TreeExplainer(model)
            print("✅ SHAP TreeExplainer initialized.")
        except Exception as e:
            print(f"⚠️  TreeExplainer not applicable: {e}")
            try:
                # Use LinearExplainer for linear models (LogisticRegression, etc.)
                if background is not None:
                    explainer = shap.LinearExplainer(model, background)
                    print("✅ SHAP LinearExplainer initialized.")
                else:
                    raise ValueError("No background data for LinearExplainer")
            except Exception as e2:
                print(f"⚠️  LinearExplainer not applicable: {e2}")
                try:
                    # Final fallback: KernelExplainer (model-agnostic, slower)
                    if background is not None:
                        explainer = shap.KernelExplainer(
                            model.predict_proba, background
                        )
                        print("✅ SHAP KernelExplainer initialized.")
                    else:
                        raise ValueError("No background data for KernelExplainer")
                except Exception as e3:
                    print(f"⚠️  SHAP initialization failed completely: {e3}")


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
        contributions = [
            {"feature": feature_names[i], "value": float(val)}
            for i, val in enumerate(values)
        ]

        # Sort by absolute impact
        print(contributions)
        contributions = [c for c in contributions if c["value"] != 0]
        contributions.sort(key=lambda x: abs(x["value"]), reverse=True)
        return contributions  # Top 5 contributors
    except Exception as e:
        print(f"Error calculating SHAP: {e}")
        return None


def predict(features):
    """Run inference using the pickle bundle."""
    feature_names = bundle["feature_cols"]
    ordered = [features[col] for col in feature_names]
    input_array = np.array([ordered], dtype=np.float32)
    input_imputed = bundle["imputer"].transform(input_array)

    proba = bundle["model"].predict_proba(input_imputed)[0][1]
    print("----")
    print(proba)
    threshold = bundle.get("threshold", 0.6)
    prediction = int(proba >= threshold)

    explanations = get_explanations(input_imputed, feature_names)

    return {
        "prediction": prediction,
        "probability": round(float(proba), 4),
        "threshold_used": threshold,
        "label": "Default" if prediction == 1 else "No Default",
        "explanations": explanations,
    }


@app.route("/predict", methods=["POST"])
def predict_route():
    """Run inference on the submitted features."""
    try:
        body = request.get_json()
        features = body.get("features")

        if not features:
            return jsonify({"error": "Missing 'features' in request body"}), 400

        result = predict(features)

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    """Serve the frontend."""
    return send_from_directory(".", "index.html")


if __name__ == "__main__":
    load_models()
    print("\n🚀 Loan Predictor API running at http://localhost:5002")
    app.run(host="0.0.0.0", port=5002, debug=True)
