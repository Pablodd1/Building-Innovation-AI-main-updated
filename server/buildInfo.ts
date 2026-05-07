// Build info - generated during CI
export const BUILD_COMMIT = process.env.GITHUB_SHA || 'unknown';
export const BUILD_TIME = new Date().toISOString();
