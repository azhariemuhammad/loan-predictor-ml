# LoanInsight AI

Loan default prediction app using **LightGBM**. Glassmorphism UI + Flask API backend.

## Quick Start

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

Open `index.html` in your browser. No model file? Server runs in **mock mode** with random predictions.

## 🚀 Deployment (Render)

1. **Push to GitHub**: Create a repository and push these files.
2. **Connect to Render**:
   - Go to [Render.com](https://render.com) → **New** → **Web Service**.
   - Select your repository.
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn server:app`
3. **Finish**: Your app will be live at `https://your-app-name.onrender.com`.

## Project Structure

```
index.html / style.css / app.js   → Frontend (Served by Flask)
server.py                         → Flask API & Static Server
Procfile                          → Render configuration
models/                           → .onnx or .pkl model files
```

