import { currentIdentity } from '../lib/session';
// Bootstrapping finishes before React mounts. Legacy localStorage UUIDs are not credentials.
export const useLocalSender = () => currentIdentity();
