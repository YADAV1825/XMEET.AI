// import { and, eq, not } from "drizzle-orm";
// import { NextRequest, NextResponse } from "next/server";

// import OpenAI from "openai";
// import { ChatCompletionMessageParam } from "openai/resources/index.mjs";

// import {
//   MessageNewEvent,
//   CallEndedEvent,
//   CallTranscriptionReadyEvent,
//   CallSessionParticipantLeftEvent,
//   CallRecordingReadyEvent,
//   CallSessionStartedEvent,
// } from "@stream-io/node-sdk";

// import { db } from "@/db";
// import { agents, meetings } from "@/db/schema";
// import { streamVideo } from "@/lib/stream-video";
// import { inngest } from "@/inngest/client";
// import { generateAvatarUri } from "@/lib/avatar";
// import { streamChat } from "@/lib/stream-chat";

// const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// function verifySignatureWithSDK(body: string, signature: string): boolean {
//   return streamVideo.verifyWebhook(body, signature);
// }

// export async function POST(request: NextRequest) {
//   const signature = request.headers.get("x-signature");
//   const apiKey = request.headers.get("x-api-key");

//   if (!signature || !apiKey) {
//     return NextResponse.json(
//       { error: "Missing signature or API key" },
//       { status: 400 }
//     );
//   }

//   const body = await request.text();

//   if (!verifySignatureWithSDK(body, signature)) {
//     return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
//   }

//   let payload: unknown;
//   try {
//     payload = JSON.parse(body);
//   } catch {
//     return NextResponse.json(
//       { error: "Invalid JSON payload" },
//       { status: 400 }
//     );
//   }

//   type StreamEvent =
//     | CallSessionStartedEvent
//     | CallSessionParticipantLeftEvent
//     | CallEndedEvent
//     | CallTranscriptionReadyEvent
//     | CallRecordingReadyEvent
//     | MessageNewEvent;

//   const eventType = (payload as StreamEvent)?.type;

//   if (eventType === "call.session_started") {
//     const event = payload as CallSessionStartedEvent;
//     const meetingId = event.call.custom?.meetingId;

//     if (!meetingId) {
//       return NextResponse.json(
//         { error: "Missing meeting ID" },
//         { status: 400 }
//       );
//     }

//     const [existedMeeting] = await db
//       .select()
//       .from(meetings)
//       .where(
//         and(
//           eq(meetings.id, meetingId),
//           not(eq(meetings.status, "completed")),
//           not(eq(meetings.status, "active")),
//           not(eq(meetings.status, "cancelled")),
//           not(eq(meetings.status, "processing"))
//         )
//       );

//     if (!existedMeeting) {
//       return NextResponse.json(
//         { error: "Meeting not found or already started" },
//         { status: 404 }
//       );
//     }

//     await db
//       .update(meetings)
//       .set({ status: "active", startedAt: new Date() })
//       .where(eq(meetings.id, existedMeeting.id));

//     const [existedAgent] = await db
//       .select()
//       .from(agents)
//       .where(eq(agents.id, existedMeeting.agentId));

//     if (!existedAgent) {
//       return NextResponse.json({ error: "Agent not found" }, { status: 404 });
//     }

//     const call = streamVideo.video.call("default", meetingId);
//     const realTimeClient = await streamVideo.video.connectOpenAi({
//       call,
//       openAiApiKey: process.env.OPENAI_API_KEY!,
//       agentUserId: existedAgent.id,
//     });

//     realTimeClient.updateSession({
//       instructions: existedAgent.instructions,
//     });
//   } else if (eventType === "call.session_participant_left") {
//     const event = payload as CallSessionParticipantLeftEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     if (!meetingId) {
//       return NextResponse.json(
//         { error: "Missing meeting ID" },
//         { status: 400 }
//       );
//     }

//     const call = streamVideo.video.call("default", meetingId);
//     await call.end();
//   } else if (eventType === "call.session_ended") {
//     const event = payload as CallEndedEvent;
//     const meetingId = event.call.custom?.meetingId;
//     if (!meetingId) {
//       return NextResponse.json(
//         { error: "Missing meeting ID" },
//         { status: 400 }
//       );
//     }
//     await db
//       .update(meetings)
//       .set({ status: "processing", endedAt: new Date() })
//       .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));
//   } else if (eventType === "call.transcription_ready") {
//     const event = payload as CallTranscriptionReadyEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     const [updatedMeeting] = await db
//       .update(meetings)
//       .set({ transcriptUrl: event.call_transcription.url })
//       .where(eq(meetings.id, meetingId))
//       .returning();

//     if (!updatedMeeting) {
//       return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
//     }

//     await inngest.send({
//       name: "meetings/processing",
//       data: {
//         meetingId: updatedMeeting.id,
//         transcriptUrl: updatedMeeting.transcriptUrl,
//       },
//     });
//   } else if (eventType === "call.recording_ready") {
//     const event = payload as CallRecordingReadyEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     await db
//       .update(meetings)
//       .set({ recordingUrl: event.call_recording.url })
//       .where(eq(meetings.id, meetingId));
//   } else if (eventType === "message.new") {
//     const event = payload as MessageNewEvent;

//     const userId = event.user?.id;
//     const channelId = event.channel_id;
//     const text = event.message?.text;

//     if (!userId || !channelId || !text) {
//       return NextResponse.json(
//         { error: "Missing user ID, channel ID, or message text" },
//         { status: 400 }
//       );
//     }

//     const [existingMeeting] = await db
//       .select()
//       .from(meetings)
//       .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

//     if (!existingMeeting) {
//       return NextResponse.json(
//         { error: "Meeting not found or not completed" },
//         { status: 404 }
//       );
//     }

//     const [existingAgent] = await db
//       .select()
//       .from(agents)
//       .where(eq(agents.id, existingMeeting.agentId));

//     if (!existingAgent) {
//       return NextResponse.json({ error: "Agent not found" }, { status: 404 });
//     }

//     if (userId !== existingAgent.id) {
//       const instructions = `
//       You are an AI assistant helping the user revisit a recently completed meeting.
//       Below is a summary of the meeting, generated from the transcript:
       
//       ${existingMeeting.summary}
      
//       The following are your original instructions from the live meeting assistant. Please continue to follow these behavioral guidelines as you assist the user:
      
//       ${existingAgent.instructions}
      
//       The user may ask questions about the meeting, request clarifications, or ask for follow-up actions.
//       Always base your responses on the meeting summary above.
      
//       You also have access to the recent conversation history between you and the user. Use the context of previous messages to provide relevant, coherent, and helpful responses. If the user's question refers to something discussed earlier, make sure to take that into account and maintain continuity in the conversation.
      
//       If the summary does not contain enough information to answer a question, politely let the user know.
      
//       Be concise, helpful, and focus on providing accurate information from the meeting and the ongoing conversation.
//       `;

//       const channel = streamChat.channel("messaging", channelId);
//       await channel.watch();

//       const previousMessages = channel.state.messages
//         .slice(-5)
//         .filter((msg) => msg.text && msg.text.trim() !== "")
//         .map<ChatCompletionMessageParam>((msg) => ({
//           role: msg.user?.id === existingAgent.id ? "assistant" : "user",
//           content: msg.text || "",
//         }));

//       const GPTResponse = await openaiClient.chat.completions.create({
//         model: "gpt-4o",
//         messages: [
//           {
//             role: "system",
//             content: instructions,
//           },
//           ...previousMessages,
//           {
//             role: "user",
//             content: text,
//           },
//         ],
//       });

//       const GPTResponseText = GPTResponse.choices[0].message?.content || "";

//       if (!GPTResponseText) {
//         return NextResponse.json(
//           { error: "No response from AI" },
//           { status: 400 }
//         );
//       }

//       const avatarUrl = generateAvatarUri({
//         seed: existingAgent.name,
//         variant: "botttsNeutral",
//       });
 
//       streamChat.upsertUser({
//         id: existingAgent.id,
//         name: existingAgent.name,
//         image: avatarUrl,
//       });

//       const existingMessages = await channel.query({ messages: { limit: 10 } });

//       const alreadyResponded = existingMessages.messages.some(
//         (msg) =>
//           msg.user?.id === existingAgent.id &&
//           new Date(msg.created_at ?? 0).getTime() >
//             new Date(event.message?.created_at ?? 0).getTime()
//       );

//       if (alreadyResponded) {
//         return NextResponse.json({ status: "already responded" });
//       }

//       channel.sendMessage({
//         text: GPTResponseText,
//         user: {
//           id: existingAgent.id,
//           name: existingAgent.name,
//           image: avatarUrl,
//         },
//       });
//     }
//   }
//   return NextResponse.json({ status: "ok" });
// }

// // import { and, eq, not } from "drizzle-orm";
// // import { NextRequest, NextResponse } from "next/server";

// // import {
// //   MessageNewEvent,
// //   CallEndedEvent,
// //   CallTranscriptionReadyEvent,
// //   CallSessionParticipantLeftEvent,
// //   CallRecordingReadyEvent,
// //   CallSessionStartedEvent,
// // } from "@stream-io/node-sdk";

// // import { db } from "@/db";
// // import { agents, meetings } from "@/db/schema";
// // import { streamVideo } from "@/lib/stream-video";
// // import { inngest } from "@/inngest/client";
// // import { generateAvatarUri } from "@/lib/avatar";
// // import { streamChat } from "@/lib/stream-chat";

// // import { GoogleGenerativeAI } from "@google/generative-ai";

// // // ✅ Gemini client
// // const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
// // const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

// // // Utility: verify Stream webhook signature
// // function verifySignatureWithSDK(body: string, signature: string): boolean {
// //   return streamVideo.verifyWebhook(body, signature);
// // }

// // export async function POST(request: NextRequest) {
// //   const signature = request.headers.get("x-signature");
// //   const apiKey = request.headers.get("x-api-key");

// //   if (!signature || !apiKey) {
// //     return NextResponse.json(
// //       { error: "Missing signature or API key" },
// //       { status: 400 }
// //     );
// //   }

// //   const body = await request.text();

// //   if (!verifySignatureWithSDK(body, signature)) {
// //     return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
// //   }

// //   let payload: unknown;
// //   try {
// //     payload = JSON.parse(body);
// //   } catch {
// //     return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
// //   }

// //   type StreamEvent =
// //     | CallSessionStartedEvent
// //     | CallSessionParticipantLeftEvent
// //     | CallEndedEvent
// //     | CallTranscriptionReadyEvent
// //     | CallRecordingReadyEvent
// //     | MessageNewEvent;

// //   const eventType = (payload as StreamEvent)?.type;

// //   // --- HANDLE EVENTS ---
// //   if (eventType === "call.session_started") {
// //     const event = payload as CallSessionStartedEvent;
// //     const meetingId = event.call.custom?.meetingId;

// //     if (!meetingId) return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });

// //     const [existedMeeting] = await db
// //       .select()
// //       .from(meetings)
// //       .where(
// //         and(
// //           eq(meetings.id, meetingId),
// //           not(eq(meetings.status, "completed")),
// //           not(eq(meetings.status, "active")),
// //           not(eq(meetings.status, "cancelled")),
// //           not(eq(meetings.status, "processing"))
// //         )
// //       );

// //     if (!existedMeeting) return NextResponse.json({ error: "Meeting not found or already started" }, { status: 404 });

// //     await db
// //       .update(meetings)
// //       .set({ status: "active", startedAt: new Date() })
// //       .where(eq(meetings.id, existedMeeting.id));
// //   } 
  
// //   else if (eventType === "call.session_participant_left") {
// //     const event = payload as CallSessionParticipantLeftEvent;
// //     const meetingId = event.call_cid.split(":")[1];

// //     if (!meetingId) return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });

// //     const call = streamVideo.video.call("default", meetingId);
// //     await call.end();
// //   } 
  
// //   else if (eventType === "call.session_ended") {
// //     const event = payload as CallEndedEvent;
// //     const meetingId = event.call.custom?.meetingId;
// //     if (!meetingId) return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });

// //     await db
// //       .update(meetings)
// //       .set({ status: "processing", endedAt: new Date() })
// //       .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));
// //   } 
  
// //   else if (eventType === "call.transcription_ready") {
// //     const event = payload as CallTranscriptionReadyEvent;
// //     const meetingId = event.call_cid.split(":")[1];

// //     const [updatedMeeting] = await db
// //       .update(meetings)
// //       .set({ transcriptUrl: event.call_transcription.url })
// //       .where(eq(meetings.id, meetingId))
// //       .returning();

// //     if (!updatedMeeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

// //     // Kick off summarization pipeline (Gemini)
// //     await inngest.send({
// //       name: "meetings/processing",
// //       data: {
// //         meetingId: updatedMeeting.id,
// //         transcriptUrl: updatedMeeting.transcriptUrl,
// //       },
// //     });
// //   } 
  
// //   else if (eventType === "call.recording_ready") {
// //     const event = payload as CallRecordingReadyEvent;
// //     const meetingId = event.call_cid.split(":")[1];

// //     await db
// //       .update(meetings)
// //       .set({ recordingUrl: event.call_recording.url })
// //       .where(eq(meetings.id, meetingId));
// //   } 
  
// //   else if (eventType === "message.new") {
// //     const event = payload as MessageNewEvent;
// //     const userId = event.user?.id;
// //     const channelId = event.channel_id;
// //     const text = event.message?.text;

// //     if (!userId || !channelId || !text) {
// //       return NextResponse.json({ error: "Missing user ID, channel ID, or message text" }, { status: 400 });
// //     }

// //     const [existingMeeting] = await db
// //       .select()
// //       .from(meetings)
// //       .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

// //     if (!existingMeeting) return NextResponse.json({ error: "Meeting not found or not completed" }, { status: 404 });

// //     const [existingAgent] = await db
// //       .select()
// //       .from(agents)
// //       .where(eq(agents.id, existingMeeting.agentId));

// //     if (!existingAgent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

// //     // System prompt
// //     const instructions = `
// //     You are an AI assistant helping the user revisit a recently completed meeting.
// //     Here is the summary:

// //     ${existingMeeting.summary}

// //     The following are your original behavioral instructions:
// //     ${existingAgent.instructions}
// //     `;

// //     const channel = streamChat.channel("messaging", channelId);
// //     await channel.watch();

// //     // --- Gemini call ---
// //     const result = await model.generateContent({
// //       contents: [
// //         { role: "user", parts: [{ text: instructions }] },
// //         { role: "user", parts: [{ text }] },
// //       ],
// //     });

// //     const replyText = result.response.text();

// //     const avatarUrl = generateAvatarUri({
// //       seed: existingAgent.name,
// //       variant: "botttsNeutral",
// //     });

// //     streamChat.upsertUser({
// //       id: existingAgent.id,
// //       name: existingAgent.name,
// //       image: avatarUrl,
// //     });

// //     channel.sendMessage({
// //       text: replyText,
// //       user: {
// //         id: existingAgent.id,
// //         name: existingAgent.name,
// //         image: avatarUrl,
// //       },
// //     });
// //   }

// //   return NextResponse.json({ status: "ok" });
// // }

// import { and, eq, not } from "drizzle-orm";
// import { NextRequest, NextResponse } from "next/server";

// import {
//   MessageNewEvent,
//   CallEndedEvent,
//   CallTranscriptionReadyEvent,
//   CallSessionParticipantLeftEvent,
//   CallRecordingReadyEvent,
//   CallSessionStartedEvent,
// } from "@stream-io/node-sdk";

// import { db } from "@/db";
// import { agents, meetings } from "@/db/schema";
// import { streamVideo } from "@/lib/stream-video";
// import { inngest } from "@/inngest/client";
// import { generateAvatarUri } from "@/lib/avatar";
// import { streamChat } from "@/lib/stream-chat";

// import { GoogleGenerativeAI, Content } from "@google/generative-ai";
// import { createClient as createDeepgramClient } from "@deepgram/sdk";

// // --- LLM (Gemini 2.5 Pro)
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// // --- Deepgram (available for future STT/TTS usage; not required in this webhook path)
// const deepgram = createDeepgramClient(process.env.DEEPGRAM_API_KEY!);

// // verify Stream webhook signature
// function verifySignatureWithSDK(body: string, signature: string): boolean {
//   return streamVideo.verifyWebhook(body, signature);
// }

// export async function POST(request: NextRequest) {
//   const signature = request.headers.get("x-signature");
//   const apiKey = request.headers.get("x-api-key");

//   if (!signature || !apiKey) {
//     return NextResponse.json(
//       { error: "Missing signature or API key" },
//       { status: 400 }
//     );
//   }

//   const body = await request.text();

//   if (!verifySignatureWithSDK(body, signature)) {
//     return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
//   }

//   let payload: unknown;
//   try {
//     payload = JSON.parse(body);
//   } catch {
//     return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
//   }

//   type StreamEvent =
//     | CallSessionStartedEvent
//     | CallSessionParticipantLeftEvent
//     | CallEndedEvent
//     | CallTranscriptionReadyEvent
//     | CallRecordingReadyEvent
//     | MessageNewEvent;

//   const eventType = (payload as StreamEvent)?.type;

//   // ----- EVENTS -----

//   if (eventType === "call.session_started") {
//     // just mark meeting active (OpenAI realtime agent removed)
//     const event = payload as CallSessionStartedEvent;
//     const meetingId = event.call.custom?.meetingId;

//     if (!meetingId) {
//       return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });
//     }

//     const [existedMeeting] = await db
//       .select()
//       .from(meetings)
//       .where(
//         and(
//           eq(meetings.id, meetingId),
//           not(eq(meetings.status, "completed")),
//           not(eq(meetings.status, "active")),
//           not(eq(meetings.status, "cancelled")),
//           not(eq(meetings.status, "processing"))
//         )
//       );

//     if (!existedMeeting) {
//       return NextResponse.json(
//         { error: "Meeting not found or already started" },
//         { status: 404 }
//       );
//     }

//     await db
//       .update(meetings)
//       .set({ status: "active", startedAt: new Date() })
//       .where(eq(meetings.id, existedMeeting.id));
//   }

//   else if (eventType === "call.session_participant_left") {
//     const event = payload as CallSessionParticipantLeftEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     if (!meetingId) {
//       return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });
//     }

//     const call = streamVideo.video.call("default", meetingId);
//     await call.end();
//   }

//   else if (eventType === "call.session_ended") {
//     const event = payload as CallEndedEvent;
//     const meetingId = event.call.custom?.meetingId;

//     if (!meetingId) {
//       return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });
//     }

//     await db
//       .update(meetings)
//       .set({ status: "processing", endedAt: new Date() })
//       .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));
//   }

//   else if (eventType === "call.transcription_ready") {
//     // Stream provides transcript URL; we kick Inngest to summarize (Gemini in functions.ts)
//     const event = payload as CallTranscriptionReadyEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     const [updatedMeeting] = await db
//       .update(meetings)
//       .set({ transcriptUrl: event.call_transcription.url })
//       .where(eq(meetings.id, meetingId))
//       .returning();

//     if (!updatedMeeting) {
//       return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
//     }

//     await inngest.send({
//       name: "meetings/processing",
//       data: {
//         meetingId: updatedMeeting.id,
//         transcriptUrl: updatedMeeting.transcriptUrl,
//       },
//     });
//   }

//   else if (eventType === "call.recording_ready") {
//     const event = payload as CallRecordingReadyEvent;
//     const meetingId = event.call_cid.split(":")[1];

//     await db
//       .update(meetings)
//       .set({ recordingUrl: event.call_recording.url })
//       .where(eq(meetings.id, meetingId));
//   }

//   else if (eventType === "message.new") {
//     // Post-meeting chat over Stream Chat powered by Gemini
//     const event = payload as MessageNewEvent;

//     const userId = event.user?.id;
//     const channelId = event.channel_id;
//     const text = event.message?.text;

//     if (!userId || !channelId || !text) {
//       return NextResponse.json(
//         { error: "Missing user ID, channel ID, or message text" },
//         { status: 400 }
//       );
//     }

//     const [existingMeeting] = await db
//       .select()
//       .from(meetings)
//       .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

//     if (!existingMeeting) {
//       return NextResponse.json(
//         { error: "Meeting not found or not completed" },
//         { status: 404 }
//       );
//     }

//     const [existingAgent] = await db
//       .select()
//       .from(agents)
//       .where(eq(agents.id, existingMeeting.agentId));

//     if (!existingAgent) {
//       return NextResponse.json({ error: "Agent not found" }, { status: 404 });
//     }

//     if (userId !== existingAgent.id) {
//       const instructions = `
// You are an AI assistant helping the user revisit a recently completed meeting.
// Here is the meeting summary:

// ${existingMeeting.summary}

// Follow the agent's original behavioral instructions:
// ${existingAgent.instructions}

// If the summary lacks enough info, say so politely.
// Keep answers concise and grounded in the summary + chat history.
// `.trim();

//       const channel = streamChat.channel("messaging", channelId);
//       await channel.watch();

//       // build last 5 messages into Gemini chat history
//       const history: Content[] = channel.state.messages
//         .slice(-5)
//         .filter((m) => m.text && m.text.trim() !== "")
//         .map<Content>((m) => ({
//           role: m.user?.id === existingAgent.id ? "model" : "user",
//           parts: [{ text: m.text as string }],
//         }));

//       // start chat with systemInstruction + history, then send user's new message
//       const model = genAI.getGenerativeModel({
//         model: "gemini-2.5-pro",
//         systemInstruction: instructions,
//       });

//       const chat = model.startChat({ history });
//       let replyText = "";
//       try {
//         const resp = await chat.sendMessage(text);
//         replyText = resp.response.text();
//       } catch (err) {
//         console.error("Gemini error:", err);
//         return NextResponse.json({ error: "LLM error" }, { status: 500 });
//       }

//       if (!replyText) {
//         return NextResponse.json({ error: "No response from LLM" }, { status: 400 });
//       }

//       const avatarUrl = generateAvatarUri({
//         seed: existingAgent.name,
//         variant: "botttsNeutral",
//       });

//       streamChat.upsertUser({
//         id: existingAgent.id,
//         name: existingAgent.name,
//         image: avatarUrl,
//       });

//       // idempotency guard
//       const existingMessages = await channel.query({ messages: { limit: 10 } });
//       const alreadyResponded = existingMessages.messages.some(
//         (msg) =>
//           msg.user?.id === existingAgent.id &&
//           new Date(msg.created_at ?? 0).getTime() >
//             new Date(event.message?.created_at ?? 0).getTime()
//       );
//       if (alreadyResponded) {
//         return NextResponse.json({ status: "already responded" });
//       }

//       await channel.sendMessage({
//         text: replyText,
//         user: {
//           id: existingAgent.id,
//           name: existingAgent.name,
//           image: avatarUrl,
//         },
//       });

//       // NOTE: If you want voice replies later:
//       // const { result } = await deepgram.speak.request({ text: replyText }, { model: "aura-asteria-en" });
//       // const file = result.toFileStream("/tmp/reply.wav"); await file.finished;
//       // then upload /tmp/reply.wav via your preferred storage and send the URL as attachment
//     }
//   }

//   return NextResponse.json({ status: "ok" });
// }


import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/index.mjs";

import {
  MessageNewEvent,
  CallEndedEvent,
  CallTranscriptionReadyEvent,
  CallSessionParticipantLeftEvent,
  CallRecordingReadyEvent,
  CallSessionStartedEvent,
} from "@stream-io/node-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";
import { generateAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function verifySignatureWithSDK(body: string, signature: string): boolean {
  return streamVideo.verifyWebhook(body, signature);
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-signature");
  const apiKey = request.headers.get("x-api-key");

  if (!signature || !apiKey) {
    return NextResponse.json({ error: "Missing signature or API key" }, { status: 400 });
  }

  const body = await request.text();
  if (!verifySignatureWithSDK(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = payload?.type;

  if (eventType === "call.session_started") {
    const meetingId = payload.call.custom?.meetingId;
    if (!meetingId) return NextResponse.json({ error: "Missing meeting ID" }, { status: 400 });

    const [existedMeeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (!existedMeeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

    if (["completed", "cancelled", "processing"].includes(existedMeeting.status)) {
      return NextResponse.json({ error: "Meeting already closed" }, { status: 400 });
    }

    await db
      .update(meetings)
      .set({ status: "active", startedAt: new Date() })
      .where(eq(meetings.id, meetingId));

    const [existedAgent] = await db.select().from(agents).where(eq(agents.id, existedMeeting.agentId));
    if (!existedAgent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const call = streamVideo.video.call("default", meetingId);
    const realTimeClient = await streamVideo.video.connectOpenAi({
      call,
      openAiApiKey: process.env.OPENAI_API_KEY!,
      agentUserId: existedAgent.id,
    });

    realTimeClient.updateSession({ instructions: existedAgent.instructions });
  }

  // keep other event handlers same, just fix meeting conditions like above

  return NextResponse.json({ status: "ok" });
}
