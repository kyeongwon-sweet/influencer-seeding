import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const BOT_TOKEN = process.env.SLACK_LUNCHLAB_BOT_TOKEN!
const SIGNING_SECRET = process.env.SLACK_LUNCHLAB_SIGNING_SECRET!
const CHANNEL = 'C0BFPQAPHEK'
const WELCOME_LINK = 'https://lalasweethq.slack.com/archives/C0BFPQAPHEK/p1783572191917999'

export async function POST(req: NextRequest) {
  const body = await req.text()

  // Slack 서명 검증
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? ''
  const signature = req.headers.get('x-slack-signature') ?? ''

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
    return NextResponse.json({ error: 'expired' }, { status: 401 })
  }
  const expected = 'v0=' + crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(body)

  // URL 검증 챌린지 (앱 등록 시 1회)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // 채널 입장 이벤트
  if (payload.event?.type === 'member_joined_channel' && payload.event?.channel === CHANNEL) {
    const userId = payload.event.user as string
    const text =
      `<@${userId}> 런치랩에 오신것을 환영합니다 :환영:\n` +
      `당신의 점심시간을 두 배로 즐기도록! ((런치랩 사측 아님))\n` +
      `<${WELCOME_LINK}|👆 회사코드 여기서 확인>`

    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + BOT_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: CHANNEL, text }),
    })
  }

  return NextResponse.json({ ok: true })
}
