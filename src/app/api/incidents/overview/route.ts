import { NextResponse } from 'next/server';
import { queryService } from '@/services/query';

export async function GET() {
  try {
    const overview = await queryService.getOperationsOverview();
    return NextResponse.json(overview);
  } catch (err) {
    console.error('[API /incidents/overview] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch operations overview' },
      { status: 500 }
    );
  }
}
