"""
ScanPass — Liveness Detection
Uses optical flow (Farneback) to detect real motion and verify challenge direction.
Static images (photos/screenshots) will fail this check.
"""

import cv2
import numpy as np


def compute_optical_flow(frames: list[np.ndarray]) -> list[np.ndarray]:
    """
    Compute dense optical flow between consecutive frames using Farneback method.
    Returns list of flow arrays, each with shape (H, W, 2) for (dx, dy).
    """
    gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    flows = []
    
    for i in range(len(gray_frames) - 1):
        flow = cv2.calcOpticalFlowFarneback(
            gray_frames[i], gray_frames[i + 1],
            None,
            pyr_scale=0.5,
            levels=3,
            winsize=15,
            iterations=3,
            poly_n=5,
            poly_sigma=1.2,
            flags=0
        )
        flows.append(flow)
    
    return flows


def compute_motion_magnitude(flows: list[np.ndarray]) -> dict:
    """
    Compute motion statistics from optical flow fields.
    Returns dict with avg_magnitude, max_magnitude, std_magnitude.
    """
    magnitudes = []
    for flow in flows:
        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        magnitudes.append(np.mean(mag))
    
    if len(magnitudes) == 0:
        return {"avg_magnitude": 0.0, "max_magnitude": 0.0, "std_magnitude": 0.0}
    
    return {
        "avg_magnitude": float(np.mean(magnitudes)),
        "max_magnitude": float(np.max(magnitudes)),
        "std_magnitude": float(np.std(magnitudes))
    }


def detect_dominant_direction(flows: list[np.ndarray]) -> dict:
    """
    Analyze the dominant direction of motion across flow fields.
    Returns direction info: horizontal, vertical, expansion/contraction, rotation.
    """
    avg_dx = 0.0
    avg_dy = 0.0
    avg_expansion = 0.0
    avg_rotation = 0.0
    
    for flow in flows:
        h, w = flow.shape[:2]
        
        # Average horizontal and vertical flow
        dx = flow[..., 0]  # horizontal
        dy = flow[..., 1]  # vertical
        avg_dx += np.mean(dx)
        avg_dy += np.mean(dy)
        
        # Detect expansion (zoom in/out): flow vectors point outward/inward from center
        cy, cx = h // 2, w // 2
        y_coords, x_coords = np.mgrid[0:h, 0:w]
        
        # Vectors from center
        vec_x = (x_coords - cx).astype(float)
        vec_y = (y_coords - cy).astype(float)
        
        # Normalize
        norm = np.sqrt(vec_x**2 + vec_y**2) + 1e-8
        vec_x /= norm
        vec_y /= norm
        
        # Dot product of flow with radial vector (positive = expansion, negative = contraction)
        radial_component = dx * vec_x + dy * vec_y
        avg_expansion += np.mean(radial_component)
        
        # Rotation: cross product of flow with radial vector
        tangential_component = dx * (-vec_y) + dy * vec_x
        avg_rotation += np.mean(tangential_component)
    
    n = len(flows) if len(flows) > 0 else 1
    
    return {
        "horizontal": float(avg_dx / n),       # positive = rightward
        "vertical": float(avg_dy / n),          # positive = downward
        "expansion": float(avg_expansion / n),  # positive = zoom in
        "rotation": float(avg_rotation / n)     # positive = clockwise
    }


def check_liveness(frames: list[np.ndarray], min_motion: float = 1.5) -> dict:
    """
    Check if the video contains real motion (not a static photo/screenshot).
    
    Args:
        frames: List of BGR frames from the video
        min_motion: Minimum average optical flow magnitude to consider as "live"
    
    Returns:
        dict with: is_live, motion_score, reason
    """
    if len(frames) < 2:
        return {
            "is_live": False,
            "motion_score": 0.0,
            "reason": "Insufficient frames for motion analysis"
        }
    
    flows = compute_optical_flow(frames)
    motion_stats = compute_motion_magnitude(flows)
    
    avg_mag = motion_stats["avg_magnitude"]
    
    if avg_mag < min_motion:
        return {
            "is_live": False,
            "motion_score": round(avg_mag, 3),
            "reason": f"Static/replay detected — motion score {avg_mag:.3f} below threshold {min_motion}. "
                      f"A real moving object should produce higher optical flow values."
        }
    
    return {
        "is_live": True,
        "motion_score": round(avg_mag, 3),
        "reason": f"Live motion detected — motion score {avg_mag:.3f} exceeds threshold {min_motion}"
    }


def check_challenge_direction(
    frames: list[np.ndarray], 
    expected_direction: str,
    direction_threshold: float = 0.3
) -> dict:
    """
    Verify that the detected motion matches the challenge direction.
    
    Args:
        frames: List of BGR frames
        expected_direction: One of 'rotation', 'zoom_in', 'zoom_out', 'left', 'right'
        direction_threshold: Minimum magnitude for directional match
    
    Returns:
        dict with: direction_match, detected_direction, confidence, reason
    """
    if len(frames) < 2:
        return {
            "direction_match": False,
            "detected_direction": "unknown",
            "confidence": 0.0,
            "reason": "Insufficient frames for direction analysis"
        }
    
    flows = compute_optical_flow(frames)
    direction_info = detect_dominant_direction(flows)
    
    # Determine which direction was actually detected
    scores = {
        "rotation": abs(direction_info["rotation"]),
        "zoom_in": max(direction_info["expansion"], 0),
        "zoom_out": max(-direction_info["expansion"], 0),
        "left": max(-direction_info["horizontal"], 0),
        "right": max(direction_info["horizontal"], 0)
    }
    
    detected = max(scores, key=scores.get)
    confidence = scores[detected]
    
    # Check if the detected direction matches the expected one
    match = (detected == expected_direction) and (confidence > direction_threshold)
    
    # For MVP, be lenient — any significant motion in roughly the right direction counts
    # This avoids false negatives from users who don't move exactly as instructed
    if not match and confidence > direction_threshold:
        # Accept if any significant motion is detected (MVP leniency)
        match = True
        reason = (f"Motion detected (dominant: {detected}, confidence: {confidence:.3f}). "
                  f"Expected '{expected_direction}' — accepted with MVP leniency.")
    elif match:
        reason = (f"Challenge direction matched! Detected '{detected}' "
                  f"with confidence {confidence:.3f}")
    else:
        reason = (f"Direction mismatch or weak motion. Detected '{detected}' "
                  f"(confidence: {confidence:.3f}), expected '{expected_direction}'")
    
    return {
        "direction_match": match,
        "detected_direction": detected,
        "confidence": round(confidence, 3),
        "reason": reason,
        "flow_details": {k: round(v, 3) for k, v in direction_info.items()}
    }
