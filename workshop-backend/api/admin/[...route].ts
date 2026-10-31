import { adminHandler } from '../../lib/handlers';
import { vercelHandler } from '../../lib/vercel';
export default vercelHandler(adminHandler);
