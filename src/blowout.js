const sharp = require('sharp');

async function createExplodedBlowout({
  imageBuffer,
  bbox,
  zoomFactor = 3.0,
  margin = 30,
  lineColor = { r: 0, g: 255, b: 0 },
  lineThickness = 2,
  fillAlpha = 0.2,
  outputScale = 1.5,
  quality = 50  // Default 50% compression
}) {
  try {
    // Load and scale the original image
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const { width: W, height: H } = metadata;

    // Scale dimensions
    const scaledW = Math.round(W * outputScale);
    const scaledH = Math.round(H * outputScale);
    
    // Scale the image with compression
    const scaledImage = await image
      .resize(scaledW, scaledH)
      .jpeg({ quality }) // Apply compression
      .toBuffer();

    // Scale bbox coordinates
    const x1 = Math.max(0, Math.min(Math.round(bbox.x1 * outputScale), scaledW));
    const y1 = Math.max(0, Math.min(Math.round(bbox.y1 * outputScale), scaledH));
    const x2 = Math.max(0, Math.min(Math.round(bbox.x2 * outputScale), scaledW));
    const y2 = Math.max(0, Math.min(Math.round(bbox.y2 * outputScale), scaledH));

    // Extract and zoom the region of interest
    const cropWidth = x2 - x1;
    const cropHeight = y2 - y1;
    
    if (cropWidth <= 0 || cropHeight <= 0) {
      throw new Error('Invalid crop dimensions');
    }

    const croppedRegion = await sharp(scaledImage)
      .extract({
        left: x1,
        top: y1,
        width: cropWidth,
        height: cropHeight
      })
      .jpeg({ quality })
      .toBuffer();

    // Zoom the cropped region
    const zoomedW = Math.round(cropWidth * zoomFactor);
    const zoomedH = Math.round(cropHeight * zoomFactor);
    
    const zoomedRegion = await sharp(croppedRegion)
      .resize(zoomedW, zoomedH)
      .jpeg({ quality })
      .toBuffer();

    // Create canvas
    const canvasWidth = scaledW + margin + zoomedW;
    const canvasHeight = Math.max(scaledH, zoomedH);

    // Create a white background
    const canvas = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    }).jpeg({ quality }).toBuffer();

    // Composite the original image
    let composite = await sharp(canvas)
      .composite([
        { input: scaledImage, left: 0, top: 0 }
      ])
      .jpeg({ quality })
      .toBuffer();

    // Add the zoomed region
    composite = await sharp(composite)
      .composite([
        { input: zoomedRegion, left: scaledW + margin, top: 0 }
      ])
      .jpeg({ quality })
      .toBuffer();

    // Draw rectangle around original region
    const svgRectangle = `
      <svg width="${canvasWidth}" height="${canvasHeight}">
        <rect 
          x="${x1}" 
          y="${y1}" 
          width="${cropWidth}" 
          height="${cropHeight}"
          fill="none"
          stroke="rgb(${lineColor.r},${lineColor.g},${lineColor.b})"
          stroke-width="${lineThickness}"
        />
      </svg>`;

    // Draw connecting lines
    const corners = [
      [x1, y1, scaledW + margin, 0],
      [x2, y1, scaledW + margin + zoomedW, 0],
      [x2, y2, scaledW + margin + zoomedW, zoomedH],
      [x1, y2, scaledW + margin, zoomedH]
    ];

    let svgLines = `
      <svg width="${canvasWidth}" height="${canvasHeight}">
        ${corners.map(([x1, y1, x2, y2]) => `
          <line 
            x1="${x1}" 
            y1="${y1}" 
            x2="${x2}" 
            y2="${y2}"
            stroke="rgb(${lineColor.r},${lineColor.g},${lineColor.b})"
            stroke-width="${lineThickness}"
          />
        `).join('')}
      </svg>`;

    // Add rectangle and lines and compress final output
    composite = await sharp(composite)
      .composite([
        { input: Buffer.from(svgRectangle), left: 0, top: 0 },
        { input: Buffer.from(svgLines), left: 0, top: 0 }
      ])
      .jpeg({ quality })
      .toBuffer();

    return composite;

  } catch (error) {
    console.error('Error creating blowout:', error);
    throw error;
  }
}

async function processDetections({
  imageBuffer,
  detections,
  zoomFactor = 3.0,
  margin = 30,
  lineColor = { r: 0, g: 255, b: 0 },
  lineThickness = 2,
  fillAlpha = 0.2,
  outputScale = 1.5,
  quality = 50  // Default 50% compression
}) {
  try {
    const blowouts = [];

    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      
      const blowout = await createExplodedBlowout({
        imageBuffer,
        bbox: detection.bbox,
        zoomFactor,
        margin,
        lineColor,
        lineThickness,
        fillAlpha,
        outputScale,
        quality
      });

      blowouts.push({
        index: i,
        buffer: blowout,
        detection
      });
    }

    return blowouts;
  } catch (error) {
    console.error('Error processing detections:', error);
    throw error;
  }
}

module.exports = {
  createExplodedBlowout,
  processDetections
}; 