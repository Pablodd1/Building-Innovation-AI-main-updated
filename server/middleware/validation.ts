import { Request, Response, NextFunction } from 'express';

export function validateAnalyzeRoom(req: Request, res: Response, next: NextFunction) {
  const { image, userId, lang } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Image is required and must be a string' });
  }

  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Image must be a base64 data URL starting with data:image/' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Check image size (base64 length * 0.75 = bytes)
  const base64Data = image.split(',')[1] || '';
  const approxBytes = base64Data.length * 0.75;
  const maxBytes = 5 * 1024 * 1024; // 5MB

  if (approxBytes > maxBytes) {
    return res.status(413).json({ error: 'Image too large. Max 5MB.' });
  }

  next();
}

export function validateGenerateOverlay(req: Request, res: Response, next: NextFunction) {
  const { originalImage, material, userId, lang } = req.body;

  if (!originalImage || typeof originalImage !== 'string') {
    return res.status(400).json({ error: 'originalImage is required and must be a string' });
  }

  if (!originalImage.startsWith('data:image/')) {
    return res.status(400).json({ error: 'originalImage must be a base64 data URL starting with data:image/' });
  }

  if (!material || !material.id) {
    return res.status(400).json({ error: 'material with id is required' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Check image size
  const base64Data = originalImage.split(',')[1] || '';
  const approxBytes = base64Data.length * 0.75;
  const maxBytes = 5 * 1024 * 1024;

  if (approxBytes > maxBytes) {
    return res.status(413).json({ error: 'Image too large. Max 5MB.' });
  }

  next();
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  
  // Don't leak error details in production
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(500).json({
    error: 'Internal server error',
    message: isDev ? err.message : 'Something went wrong',
    ...(isDev && { stack: err.stack })
  });
}
