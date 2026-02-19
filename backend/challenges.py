"""
ScanPass — Challenge Generator
Produces random movement-based challenges for anti-replay authentication.
"""

import random

CHALLENGES = [
    {
        "id": "rotate_clockwise",
        "text": "🔄 Rotate your object clockwise slowly",
        "expected_direction": "rotation",
        "description": "Rotate the object in a clockwise direction"
    },
    {
        "id": "move_closer",
        "text": "🔍 Move your object closer to the camera",
        "expected_direction": "zoom_in",
        "description": "Bring the object towards the camera"
    },
    {
        "id": "tilt_left",
        "text": "↙️ Tilt your object to the left",
        "expected_direction": "left",
        "description": "Tilt or move the object to the left"
    },
    {
        "id": "move_away",
        "text": "🔭 Move your object away from the camera",
        "expected_direction": "zoom_out",
        "description": "Pull the object away from the camera"
    },
    {
        "id": "tilt_right",
        "text": "↗️ Tilt your object to the right",
        "expected_direction": "right",
        "description": "Tilt or move the object to the right"
    }
]


def get_random_challenge() -> dict:
    """Return a random challenge for the user."""
    return random.choice(CHALLENGES)


def get_challenge_by_id(challenge_id: str) -> dict | None:
    """Get a specific challenge by its ID."""
    for c in CHALLENGES:
        if c["id"] == challenge_id:
            return c
    return None
