import pickle
import numpy as np
import json
import os
import onnxruntime as ort
from appwrite.client import Client
from appwrite.services.storage import Storage

client = Client()
client.set_endpoint(os.environ["APPWRITE_FUNCTION_API_ENDPOINT"])
client.set_project(os.environ["APPWRITE_FUNCTION_PROJECT_ID"])
client.set_key(os.environ["APPWRITE_API_KEY"])

storage = Storage(client)

imputer_session = None
model_session = None
metadata = None

def load_models():
    global imputer_session, model_session, metadata

    imputer_bytes = storage.get_file_download(
        bucket_id=os.environ["BUCKET_ID"],
        file_id=os.environ["IMPUTER_FILE_ID"]
    )
    model_bytes = storage.get_file_download(
        bucket_id=os.environ["BUCKET_ID"],
        file_id=os.environ["MODEL_FILE_ID"]
    )
    meta_bytes = storage.get_file_download(
        bucket_id=os.environ["BUCKET_ID"],
        file_id=os.environ["METADATA_FILE_ID"]
    )

    imputer_session = ort.InferenceSession(bytes(imputer_bytes))
    model_session   = ort.InferenceSession(bytes(model_bytes))
    metadata        = pickle.loads(bytes(meta_bytes))

def main(context):
    global imputer_session, model_session, metadata

    if model_session is None:
        load_models()

    try:
        body     = json.loads(context.req.body)
        features = body.get("features")

        ordered      = [features[col] for col in metadata["feature_columns"]]
        input_array  = np.array([ordered], dtype=np.float32)

        imputer_input = {imputer_session.get_inputs()[0].name: input_array}
        imputed_array = imputer_session.run(None, imputer_input)[0]

        model_input   = {model_session.get_inputs()[0].name: imputed_array.astype(np.float32)}
        outputs       = model_session.run(None, model_input)

        proba_default = float(outputs[1][0][1])
        threshold     = metadata["threshold"]
        prediction    = int(proba_default >= threshold)

        return context.res.json({
            "prediction":     prediction,
            "probability":    round(proba_default, 4),
            "threshold_used": threshold,
            "label":          "Default" if prediction == 1 else "No Default"
        })

    except Exception as e:
        return context.res.json({"error": str(e)}, 500)
