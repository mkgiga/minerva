/**
 * Image preprocessing utilities for Stable Diffusion expression generation.
 * Ported from agents/character-generator-old.py
 */

import sharp from 'sharp';

const MIN_DIMENSION = 768;
const MAX_DIMENSION = 1344;

/**
 * Calculate target dimensions that satisfy:
 * 1. Both dimensions are between MIN_DIMENSION and MAX_DIMENSION
 * 2. Aspect ratio is preserved
 * 3. Only resize if image is outside valid range
 * 4. Dimensions are divisible by 8 for SD compatibility
 *
 * @param {number} width - Original width
 * @param {number} height - Original height
 * @returns {{width: number, height: number}} Target dimensions
 */
export function calculateTargetDimensions(width, height) {
    // Round to nearest 8 for SD compatibility
    let newWidth = Math.floor(width / 8) * 8;
    let newHeight = Math.floor(height / 8) * 8;

    // Check if already within valid range
    if (newWidth >= MIN_DIMENSION && newWidth <= MAX_DIMENSION &&
        newHeight >= MIN_DIMENSION && newHeight <= MAX_DIMENSION) {
        return { width: newWidth, height: newHeight };
    }

    const aspectRatio = width / height;

    // Image is too large - scale down
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width >= height) {
            newWidth = MAX_DIMENSION;
            newHeight = Math.round(newWidth / aspectRatio);
        } else {
            newHeight = MAX_DIMENSION;
            newWidth = Math.round(newHeight * aspectRatio);
        }
    }

    // Image is too small - scale up
    if (newWidth < MIN_DIMENSION || newHeight < MIN_DIMENSION) {
        if (width >= height) {
            newHeight = MIN_DIMENSION;
            newWidth = Math.round(newHeight * aspectRatio);
        } else {
            newWidth = MIN_DIMENSION;
            newHeight = Math.round(newWidth / aspectRatio);
        }
    }

    // Final clamp to max (in case scaling up made one dimension too large)
    if (newWidth > MAX_DIMENSION) {
        newWidth = MAX_DIMENSION;
    }
    if (newHeight > MAX_DIMENSION) {
        newHeight = MAX_DIMENSION;
    }

    // Round to nearest 8 for SD compatibility
    newWidth = Math.floor(newWidth / 8) * 8;
    newHeight = Math.floor(newHeight / 8) * 8;

    return { width: newWidth, height: newHeight };
}

/**
 * Preprocess an image for Stable Diffusion:
 * - Resize to valid dimensions (768-1344px, divisible by 8)
 * - Convert to RGB (remove alpha channel)
 * - Return as PNG base64
 *
 * @param {string} base64Data - Base64 encoded image data (without data URI prefix)
 * @returns {Promise<{base64: string, width: number, height: number}>}
 */
export async function preprocessImage(base64Data) {
    // Decode base64 to buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Get original dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const origWidth = metadata.width;
    const origHeight = metadata.height;

    // Calculate target dimensions
    const { width: targetWidth, height: targetHeight } = calculateTargetDimensions(origWidth, origHeight);

    // Process image: remove alpha, resize if needed, convert to PNG
    let pipeline = sharp(imageBuffer)
        .removeAlpha() // Convert to RGB (remove alpha channel)
        .flatten({ background: { r: 255, g: 255, b: 255 } }); // Flatten with white background

    // Resize if dimensions changed
    if (origWidth !== targetWidth || origHeight !== targetHeight) {
        pipeline = pipeline.resize(targetWidth, targetHeight, {
            kernel: sharp.kernel.lanczos3 // High quality resampling (closest to PIL's LANCZOS)
        });
    }

    // Convert to PNG buffer
    const outputBuffer = await pipeline.png().toBuffer();
    const newBase64 = outputBuffer.toString('base64');

    return {
        base64: newBase64,
        width: targetWidth,
        height: targetHeight
    };
}

/**
 * Preprocess a mask image:
 * - Resize to match target dimensions
 * - Keep original color mode (no RGB conversion)
 * - Return as PNG base64
 *
 * @param {string} base64Data - Base64 encoded mask data (without data URI prefix)
 * @param {number} targetWidth - Target width to resize to
 * @param {number} targetHeight - Target height to resize to
 * @returns {Promise<string>} Base64 encoded preprocessed mask
 */
export async function preprocessMask(base64Data, targetWidth, targetHeight) {
    // Decode base64 to buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Get original dimensions
    const metadata = await sharp(imageBuffer).metadata();

    let pipeline = sharp(imageBuffer);

    // Resize to match target dimensions if needed
    if (metadata.width !== targetWidth || metadata.height !== targetHeight) {
        pipeline = pipeline.resize(targetWidth, targetHeight, {
            kernel: sharp.kernel.lanczos3
        });
    }

    // Convert to PNG buffer
    const outputBuffer = await pipeline.png().toBuffer();
    return outputBuffer.toString('base64');
}

/**
 * Extract base64 data from a data URI or return as-is if already base64.
 *
 * @param {string} input - Data URI or base64 string
 * @returns {string} Base64 string without data URI prefix
 */
export function extractBase64(input) {
    if (input.startsWith('data:')) {
        // Extract base64 from data URI
        const matches = input.match(/^data:image\/[a-z]+;base64,(.+)$/i);
        if (matches && matches[1]) {
            return matches[1];
        }
        throw new Error('Invalid data URI format');
    }
    return input;
}
