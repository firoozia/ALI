"""
Grasshopper File Analyzer — FastAPI backend
"""
import os
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from parser.gh_parser import parse_file
from agent.analyzer import analyze

load_dotenv()

app = FastAPI(title="Grasshopper Analyzer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_class=HTMLResponse)
async def root():
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.post("/analyze")
async def analyze_file(
    file: UploadFile = File(...),
    api_key: str = Form(default=""),
):
    filename = file.filename or ""
    if not filename.lower().endswith((".gh", ".ghx")):
        raise HTTPException(status_code=400, detail="Only .gh and .ghx files are supported")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    try:
        definition = parse_file(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {e}")

    if len(definition.components) == 0:
        raise HTTPException(
            status_code=422,
            detail="No components found. Make sure to upload a valid Grasshopper file."
        )

    effective_key = api_key.strip() or os.environ.get("ANTHROPIC_API_KEY", "")

    try:
        result = analyze(definition, api_key=effective_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")

    return JSONResponse({
        "filename": filename,
        "component_count": len(definition.components),
        "wire_count": len(definition.wires),
        "analysis": result,
    })


@app.get("/health")
async def health():
    return {"status": "ok"}
