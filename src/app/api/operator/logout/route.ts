import { NextRequest, NextResponse } from 'next/server';
import { clearOperatorCookie } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({
    success: true,
    authenticated: false,
    message: 'Operator session terminated',
  });
  clearOperatorCookie(res);
  return res;
}
