import { handleApi } from '@/lib/server/backend';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleApi(request, (await context.params).path);
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
