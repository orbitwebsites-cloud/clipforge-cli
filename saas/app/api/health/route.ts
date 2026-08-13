export async function GET() {
  return Response.json({ ok: true, service: 'clipforge-cloud', time: new Date().toISOString(), slaMinutes: 180 });
}
