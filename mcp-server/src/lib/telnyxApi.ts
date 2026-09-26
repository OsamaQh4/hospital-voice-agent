import type Telnyx from "telnyx";

export interface SendSmsParams {
  to: string;
  from: string;
  text: string;
}

export async function sendSms(telnyx: Telnyx, params: SendSmsParams): Promise<string> {
  const response = await telnyx.messages.send({
    to: params.to,
    from: params.from,
    text: params.text,
  });
  const messageId = response.data?.id;
  if (!messageId) {
    throw new Error("Telnyx messages.send response did not include a message id");
  }
  return messageId;
}
