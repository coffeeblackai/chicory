import os
import cv2
import numpy as np
from pathlib import Path
from datetime import datetime

def create_debug_video(debug_dir='debug', output_file='debug_visualization.mp4', frames_per_step=30):
    # Get all debug directories sorted by timestamp
    debug_path = Path(debug_dir)
    debug_dirs = []
    
    for d in debug_path.iterdir():
        if d.is_dir() and d.name.startswith('202'):  # Filter for timestamp directories
            try:
                # Parse the timestamp from directory name
                timestamp = datetime.strptime(d.name, '%Y-%m-%dT%H-%M-%S-%fZ')
                debug_dirs.append((timestamp, d))
            except ValueError:
                continue
    
    # Sort directories by timestamp
    debug_dirs.sort(key=lambda x: x[0])
    
    if not debug_dirs:
        print("No debug directories found!")
        return
    
    # Get first image to determine dimensions
    first_vis = None
    for _, d in debug_dirs:
        vis_path = d / 'visualization.png'
        if vis_path.exists():
            first_vis = cv2.imread(str(vis_path))
            break
    
    if first_vis is None:
        print("No visualization images found!")
        return
    
    # Initialize video writer
    height, width = first_vis.shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_file, fourcc, 30.0, (width, height))
    
    # Process each debug directory
    for timestamp, debug_dir in debug_dirs:
        vis_path = debug_dir / 'visualization.png'
        
        if vis_path.exists():
            frame = cv2.imread(str(vis_path))
            if frame is not None:
                # Write the same frame multiple times to create a pause
                for _ in range(frames_per_step):
                    out.write(frame)
                print(f"Processed {vis_path}")
            else:
                print(f"Failed to read {vis_path}")
    
    # Release video writer
    out.release()
    print(f"\nVideo saved to {output_file}")

if __name__ == "__main__":
    create_debug_video() 