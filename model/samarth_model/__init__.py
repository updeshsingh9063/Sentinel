"""Scoring, NLP and ranking for Samarth Sentinel.

Layering follows the PRD:

    Layer A  rules      -- clinical thresholds, no training
    Layer B  baseline   -- deviation from the senior own median/MAD
    Layer C  ml         -- LightGBM plus Isolation Forest on windowed features

Imported by both the API (backend/app) and the training scripts, so nothing in
here may import FastAPI or Supabase.
"""

__version__ = "0.1.0"
