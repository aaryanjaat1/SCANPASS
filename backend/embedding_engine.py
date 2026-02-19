"""
ScanPass — CNN Embedding Engine
Uses MobileNetV2 (pretrained) to extract visual embeddings from video frames.
No raw images are stored — only the averaged embedding vector.
"""

import io
import cv2
import numpy as np
import torch
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
from sklearn.metrics.pairwise import cosine_similarity

# --- Model Setup ---
# Load MobileNetV2 pretrained, remove classifier head to get 1280-dim features
_model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
_model.classifier = torch.nn.Identity()  # Remove classification head
_model.eval()

# Standard ImageNet preprocessing
_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])


def extract_frames(video_bytes: bytes, n_frames: int = 10) -> list[np.ndarray]:
    """
    Extract N evenly-spaced frames from a video file (bytes).
    Returns list of BGR numpy arrays (OpenCV format).
    """
    # Write bytes to a temporary buffer for OpenCV
    import tempfile
    import os
    
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name
        
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise ValueError("Could not open video file")
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            # Fallback: read all available frames
            frames = []
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)
            cap.release()
            if len(frames) == 0:
                raise ValueError("No frames could be extracted from video")
            # Sample evenly
            if len(frames) > n_frames:
                indices = np.linspace(0, len(frames) - 1, n_frames, dtype=int)
                frames = [frames[i] for i in indices]
            return frames
        
        # Calculate indices for evenly-spaced frames
        indices = np.linspace(0, total_frames - 1, n_frames, dtype=int)
        
        frames = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                frames.append(frame)
        
        cap.release()
        
        if len(frames) == 0:
            raise ValueError("No frames could be extracted from video")
        
        return frames
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def frame_to_embedding(frame: np.ndarray) -> np.ndarray:
    """
    Convert a single BGR frame to a 1280-dim embedding vector.
    """
    # Convert BGR (OpenCV) to RGB (PIL)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb)
    
    # Preprocess and run through model
    tensor = _transform(pil_image).unsqueeze(0)  # Add batch dim
    
    with torch.no_grad():
        embedding = _model(tensor)
    
    return embedding.squeeze().numpy()  # 1280-dim vector


def get_average_embedding(frames: list[np.ndarray]) -> np.ndarray:
    """
    Compute the average embedding across all frames.
    This creates a robust representation of the object.
    """
    embeddings = [frame_to_embedding(f) for f in frames]
    avg = np.mean(embeddings, axis=0)
    # L2 normalize for stable cosine similarity
    avg = avg / (np.linalg.norm(avg) + 1e-8)
    return avg


def get_frame_embeddings(frames: list[np.ndarray]) -> list[np.ndarray]:
    """
    Get individual embeddings for each frame (used for liveness variance check).
    """
    return [frame_to_embedding(f) for f in frames]


def compute_similarity(emb1: list | np.ndarray, emb2: list | np.ndarray) -> float:
    """
    Compute cosine similarity between two embedding vectors.
    Returns float in range [-1, 1], where 1 = identical.
    """
    a = np.array(emb1).reshape(1, -1)
    b = np.array(emb2).reshape(1, -1)
    return float(cosine_similarity(a, b)[0][0])
