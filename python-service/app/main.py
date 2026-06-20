"""
File: main.py
Description: FastAPI entry point for SwingTrader AI Python microservice
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analyze, screen
from app.config import LOG_LEVEL

logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
logger = logging.getLogger(__name__)

app = FastAPI(
    title="SwingTrader AI — Python Microservice",
    description="Provides OHLCV data, technical indicators, and support/resistance levels",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://server:5000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(analyze.router)
app.include_router(screen.router)


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint for Docker healthcheck and Node.js pythonBridge."""
    return {"status": "healthy", "service": "swing-trader-python"}
