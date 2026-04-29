import type { Express } from 'express';
import { imagekit } from '../config/imagekit.js';

export const uploadMedia = async (file: Express.Multer.File, folder: string) => {
  const uploaded = await imagekit.upload({
    file: file.buffer,
    fileName: `${Date.now()}-${file.originalname}`,
    folder
  });
  return { fileUrl: uploaded.url, filePath: uploaded.filePath, fileId: uploaded.fileId };
};

export const deleteMediaByFileId = async (fileId: string) => {
  await imagekit.deleteFile(fileId);
};
