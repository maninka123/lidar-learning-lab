import { publicHandler } from '../../lib/handlers';
import { vercelHandler } from '../../lib/vercel';
export default vercelHandler(publicHandler);
