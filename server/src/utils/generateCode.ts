import { customAlphabet } from 'nanoid';
import { LIMITS } from '../constants/limits.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const createCode = customAlphabet(alphabet, LIMITS.CODE_LENGTH);

export const generateCode = () => createCode();
