/**
 * Stable Diffusion WebUI API client for expression generation.
 * Implements img2img with ControlNet reference_only.
 * Ported from agents/character-generator-old.py
 */

const DEFAULT_TIMEOUT = 300000; // 5 minutes

/**
 * Create a SD WebUI client with the given configuration.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.sdApiUrl - Base URL for SD WebUI API
 * @param {string} [config.modelName] - Checkpoint model name (empty = use current)
 * @param {string} [config.samplerName='Euler'] - Sampler name
 * @param {string} [config.schedulerName='SGM Uniform'] - Scheduler name
 * @param {number} [config.cfgScale=5.0] - CFG scale
 * @param {number} [config.denoiseStrength=0.7] - Denoising strength
 * @param {number} [config.steps=20] - Number of steps
 * @returns {Object} SD client methods
 */
export function createSdClient(config) {
    const {
        sdApiUrl,
        modelName = '',
        samplerName = 'Euler',
        schedulerName = 'SGM Uniform',
        cfgScale = 5.0,
        denoiseStrength = 0.7,
        steps = 20
    } = config;

    /**
     * Check if SD WebUI is reachable and responding.
     *
     * @returns {Promise<{available: boolean, error?: string}>}
     */
    async function healthCheck() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${sdApiUrl}/sdapi/v1/sd-models`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return { available: true };
            }
            return { available: false, error: `SD WebUI returned status ${response.status}` };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { available: false, error: 'Connection timed out' };
            }
            return { available: false, error: error.message };
        }
    }

    /**
     * Generate image variations using img2img with reference_only ControlNet.
     *
     * @param {Object} options - Generation options
     * @param {string} options.baseImageData - Base64 encoded reference image
     * @param {string} options.prompt - Prompt for generation
     * @param {number} options.width - Image width
     * @param {number} options.height - Image height
     * @param {string} [options.negativePrompt] - Negative prompt
     * @param {string} [options.maskData] - Base64 encoded mask for inpainting
     * @param {number} [options.seed=-1] - Seed (-1 for random)
     * @param {Object} [options.overrides] - Override default config values
     * @returns {Promise<string[]>} Array of base64 encoded generated images
     */
    async function img2img(options) {
        const {
            baseImageData,
            prompt,
            width,
            height,
            negativePrompt = '(worst quality:1.2), (low quality:1.2), (blurry)',
            maskData = null,
            seed = -1,
            overrides = {}
        } = options;

        // Merge overrides with defaults
        const finalSamplerName = overrides.samplerName ?? samplerName;
        const finalSchedulerName = overrides.schedulerName ?? schedulerName;
        const finalSteps = overrides.steps ?? steps;
        const finalCfgScale = overrides.cfgScale ?? cfgScale;
        const finalDenoiseStrength = overrides.denoiseStrength ?? denoiseStrength;
        const finalModelName = overrides.modelName ?? modelName;

        const payload = {
            init_images: [baseImageData],
            prompt: prompt,
            negative_prompt: negativePrompt,
            sampler_name: finalSamplerName,
            scheduler: finalSchedulerName,
            steps: finalSteps,
            cfg_scale: finalCfgScale,
            denoising_strength: finalDenoiseStrength,
            width: width,
            height: height,
            seed: seed,
            inpainting_fill: 1, // Original
            batch_size: 1,
            n_iter: 1,
            do_not_save_samples: true,
            do_not_save_grid: true,
            send_images: true,
            save_images: false,
            override_settings: {
                img2img_color_correction: true,
                sd_noise_schedule: 'Zero Terminal SNR',
            },
            alwayson_scripts: {
                controlnet: {
                    args: [
                        {
                            enabled: true,
                            module: 'reference_only',
                            model: 'None', // reference_only doesn't need a model
                            weight: 1.9,
                            resize_mode: 'Crop and Resize',
                            image: baseImageData,
                            processor_res: 1024,
                            threshold_a: 0.5, // Style Fidelity (0.0-1.0)
                            threshold_b: -1,
                            guidance_start: 0.0,
                            guidance_end: 1.0,
                            control_mode: 'Balanced',
                            pixel_perfect: false,
                        }
                    ]
                }
            },
        };

        // Add model override if specified
        if (finalModelName) {
            payload.override_settings.sd_model_checkpoint = finalModelName;
        }

        // Add mask for inpainting if provided
        if (maskData) {
            payload.mask = maskData;
            payload.mask_blur = 4; // 4px blur
            payload.inpaint_full_res = true; // Only masked region
            payload.inpaint_full_res_padding = 32; // 32px padding
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

        try {
            const response = await fetch(`${sdApiUrl}/sdapi/v1/img2img`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`SD WebUI returned status ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            return result.images || [];
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Generation timed out after 5 minutes');
            }
            throw error;
        }
    }

    return {
        healthCheck,
        img2img
    };
}
