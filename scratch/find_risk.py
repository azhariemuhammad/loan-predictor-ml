import pickle
import numpy as np

def find_high_risk():
    with open('models/loan_model.pkl', 'rb') as f:
        bundle = pickle.load(f)
    
    model = bundle['model']
    imputer = bundle['imputer']
    
    max_proba = 0
    best_sample = None
    
    # Try 1000 random combinations
    for _ in range(1000):
        sample = np.random.randint(1, 5, (1, 17))
        imputed = imputer.transform(sample)
        proba = model.predict_proba(imputed)[0][1]
        
        if proba > max_proba:
            max_proba = proba
            best_sample = sample
            
    print(f"Highest Probability: {max_proba * 100:.2f}%")
    if best_sample is not None:
        print(f"Sample: {best_sample.tolist()[0]}")
        print(f"Columns: {bundle['feature_cols']}")

if __name__ == "__main__":
    find_high_risk()
