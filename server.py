"""
Local Flask server for loan prediction inference.

Supports two model formats (checked in order):
  1. ONNX  — imputer.onnx + lgbm_model.onnx + metadata.pkl in models/
  2. Pickle — single .pkl bundle in models/

Falls back to mock predictions if no model files are found.

Usage:
    pip install -r requirements.txt
    python server.py
"""

import os
import pickle
import glob

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)


MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Global model state
inference_mode = None  # "onnx" | "pickle" | "mock"
bundle = None
imputer_session = None
model_session = None
metadata = None


def load_models():
    """Load model files from the local models/ directory."""
    global inference_mode, bundle, imputer_session, model_session, metadata

    imputer_path = os.path.join(MODELS_DIR, "imputer.onnx")
    model_path = os.path.join(MODELS_DIR, "lgbm_model.onnx")
    meta_path = os.path.join(MODELS_DIR, "metadata.pkl")

    # --- Try ONNX first ---
    if os.path.exists(imputer_path) and os.path.exists(model_path) and os.path.exists(meta_path):
        try:
            import onnxruntime as ort

            imputer_session = ort.InferenceSession(imputer_path)
            model_session = ort.InferenceSession(model_path)

            with open(meta_path, "rb") as f:
                metadata = pickle.load(f)

            inference_mode = "onnx"
            print("✅ ONNX models loaded successfully.")
            print(f"   Features: {len(metadata['feature_columns'])} columns")
            print(f"   Threshold: {metadata['threshold']}")
            return
        except ImportError:
            print("⚠️  ONNX files found but onnxruntime is not installed.")
            print("   Install it with: pip install onnxruntime")
        except Exception as e:
            print(f"⚠️  Failed to load ONNX models: {e}")

    # --- Fallback to pickle bundle ---
    pkl_files = glob.glob(os.path.join(MODELS_DIR, "*.pkl"))
    # Exclude metadata.pkl from bundle search
    pkl_files = [p for p in pkl_files if os.path.basename(p) != "metadata.pkl"]

    if pkl_files:
        bundle_path = pkl_files[0]
        print(f"   Loading pickle bundle: {bundle_path}")

        with open(bundle_path, "rb") as f:
            bundle = pickle.load(f)

        expected_keys = ["model", "imputer", "feature_cols", "threshold"]
        missing = [k for k in expected_keys if k not in bundle]
        if missing:
            print(f"\n⚠️  Bundle is missing keys: {missing}")
            print("   Running in MOCK MODE.\n")
            bundle = None
            inference_mode = "mock"
            return

        inference_mode = "pickle"
        print("✅ Pickle model bundle loaded successfully.")
        print(f"   Features: {len(bundle['feature_cols'])} columns")
        print(f"   Threshold: {bundle['threshold']}")
        return

    # --- No models found ---
    print("\n⚠️  No model files found in models/ directory.")
    print(f"   Place your ONNX files or .pkl bundle in: {MODELS_DIR}")
    print("\n   Running in MOCK MODE — predictions will be random.\n")
    inference_mode = "mock"


def predict_onnx(features):
    """Run inference using ONNX runtime."""
    ordered = [features[col] for col in metadata["feature_columns"]]
    input_array = np.array([ordered], dtype=np.float32)

    # Run imputer
    imputer_input = {imputer_session.get_inputs()[0].name: input_array}
    imputed_array = imputer_session.run(None, imputer_input)[0]

    # Run LightGBM model
    model_input = {model_session.get_inputs()[0].name: imputed_array.astype(np.float32)}
    outputs = model_session.run(None, model_input)

    proba_default = float(outputs[1][0][1])
    threshold = metadata["threshold"]
    prediction = int(proba_default >= threshold)

    return {
        "prediction": prediction,
        "probability": round(proba_default, 4),
        "threshold_used": threshold,
        "label": "Default" if prediction == 1 else "No Default",
    }


def predict_pickle(features):
    """Run inference using the pickle bundle."""
    ordered = [features[col] for col in bundle["feature_cols"]]
    input_array = np.array([ordered])
    input_imputed = bundle["imputer"].transform(input_array)

    proba = bundle["model"].predict_proba(input_imputed)[0][1]
    threshold = bundle["threshold"]
    prediction = int(proba >= threshold)

    return {
        "prediction": prediction,
        "probability": round(float(proba), 4),
        "threshold_used": threshold,
        "label": "Default" if prediction == 1 else "No Default",
    }


def predict_mock():
    """Return a plausible mock prediction."""
    prob = round(np.random.uniform(0.05, 0.85), 4)
    prediction = int(prob >= 0.5)
    return {
        "prediction": prediction,
        "probability": prob,
        "threshold_used": 0.5,
        "label": "Default" if prediction == 1 else "No Default",
        "mock": True,
    }


@app.route("/predict", methods=["POST"])
def predict():
    """Run inference on the submitted features."""
    try:
        body = request.get_json()
        features = body.get("features")

        if not features:
            return jsonify({"error": "Missing 'features' in request body"}), 400

        if inference_mode == "onnx":
            result = predict_onnx(features)
        elif inference_mode == "pickle":
            result = predict_pickle(features)
        else:
            result = predict_mock()

        return jsonify(result)

    except KeyError as e:
        return jsonify({"error": f"Missing feature in request: {str(e)}", "expected_features": list(bundle['feature_cols'] if bundle else metadata['feature_columns'])}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    """Serve the frontend."""
    return send_from_directory(".", "index.html")


@app.route("/health", methods=["GET"])

def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "inference_mode": inference_mode,
    })


if __name__ == "__main__":
    load_models()
    print(f"\n🚀 Loan Predictor API running at http://localhost:5002")
    print(f"   Mode: {inference_mode}\n")
    app.run(host="0.0.0.0", port=5002, debug=True)
