import { studentHandler } from '../../lib/handlers';
import { vercelHandler } from '../../lib/vercel';
export default vercelHandler(studentHandler);
