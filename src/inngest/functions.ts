import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { StreamTranscriptItem } from "@/modules/meetings/types";
import { eq, inArray } from "drizzle-orm";
import JSONL from "jsonl-parse-stringify";
import { createAgent, openai, TextMessage } from "@inngest/agent-kit";

const summarizer = createAgent({
  name: "Summarizer",
  system: `
    You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the session's content. Focus on major features, user workflows, and any key takeaways. Write in a narrative style, using full sentences. Highlight unique or powerful aspects of the product, platform, or discussion.

### Notes
Break down key content into thematic sections with timestamp ranges. Each section should summarize key points, actions, or demos in bullet format.

Example: 
#### Section Name
- Main point or demo shown here
- Another key insight or interaction
- Follow-up tool or explanation provided

#### Next Section
- Feature X automatically does Y
- Mention of integration with Z
  `.trim(),
  model: openai({
    model: "gpt-4o", // Use the GPT-4o model
    apiKey: process.env.OPENAI_API_KEY,
  }),
});

export const meetingsProcessing = inngest.createFunction(
  { id: "meetings/processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    const response = await step.run("fetch-transcript", async () => {
      return fetch(event.data.transcriptUrl).then((res) => res.text());
    });

    const transcript = await step.run("Parse transcription", async () => {
      return JSONL.parse<StreamTranscriptItem>(response);
    });

    const transcriptWithSpeakers = await step.run("add-speakers", async () => {
      const speakerIds = [
        ...new Set(transcript.map((item) => item.speaker_id)),
      ];

      const userSpeakers = await db
        .select()
        .from(user)
        .where(inArray(user.id, speakerIds))
        .then((users) =>
          users.map((user) => ({
            ...user,
          }))
        );

      const agentSpeakers = await db
        .select()
        .from(agents)
        .where(inArray(agents.id, speakerIds))
        .then((agents) =>
          agents.map((agent) => ({
            ...agent,
          }))
        );

      const speakers = [...userSpeakers, ...agentSpeakers];

      return transcript.map((item) => {
        const speaker = speakers.find(
          (speaker) => speaker.id === item.speaker_id
        );

        if (!speaker) {
          return {
            ...item,
            user: {
              name: "Unknown",
            },
          };
        }

        return {
          ...item,
          user: {
            name: speaker.name,
          },
        };
      });
    });

    const { output } = await summarizer.run(
      "Summarize the following transcript" +
        JSON.stringify(transcriptWithSpeakers)
    );

    await step.run("save-summary", async () => {
      return db
        .update(meetings)
        .set({
          summary: (output[0] as TextMessage).content as string,
          status: "completed",
        })
        .where(eq(meetings.id, event.data.meetingId))
        .returning();
    });
  }
);

// import { db } from "@/db";
// import { agents, meetings, user } from "@/db/schema";
// import { inngest } from "@/inngest/client";
// import { StreamTranscriptItem } from "@/modules/meetings/types";
// import { eq, inArray } from "drizzle-orm";
// import JSONL from "jsonl-parse-stringify";
// import { GoogleGenerativeAI } from "@google/generative-ai";

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// export const meetingsProcessing = inngest.createFunction(
//   { id: "meetings/processing" },
//   { event: "meetings/processing" },
//   async ({ event, step }) => {
//     // 1) fetch transcript JSONL
//     const response = await step.run("fetch-transcript", async () => {
//       return fetch(event.data.transcriptUrl).then((res) => res.text());
//     });

//     // 2) parse JSONL -> array of StreamTranscriptItem
//     const transcript = await step.run("Parse transcription", async () => {
//       return JSONL.parse<StreamTranscriptItem>(response);
//     });

//     // 3) join speaker names
//     const transcriptWithSpeakers = await step.run("add-speakers", async () => {
//       const speakerIds = [...new Set(transcript.map((item) => item.speaker_id))];

//       const userSpeakers = await db
//         .select()
//         .from(user)
//         .where(inArray(user.id, speakerIds));

//       const agentSpeakers = await db
//         .select()
//         .from(agents)
//         .where(inArray(agents.id, speakerIds));

//       const speakers = [...userSpeakers, ...agentSpeakers];

//       return transcript.map((item) => {
//         const sp = speakers.find((s) => s.id === item.speaker_id);
//         return {
//           ...item,
//           user: { name: sp?.name || "Unknown" },
//         };
//       });
//     });

//     // 4) summarization with Gemini 2.5 Pro
//     const systemInstruction = `
// You are an expert summarizer. Write readable, concise, simple content.

// Use this markdown structure:

// ### Overview
// Provide a clear, engaging summary of the session's content, workflows, and key takeaways.

// ### Notes
// Break content into sections with timestamp ranges. Use bullet points for actions, demos, and insights.
// `.trim();

//     const model = genAI.getGenerativeModel({
//       model: "gemini-2.5-pro",
//       systemInstruction,
//     });

//     // single user message containing the transcript JSON
//     const prompt = "Summarize the following transcript:\n" +
//       JSON.stringify(transcriptWithSpeakers);

//     let summaryText = "";
//     try {
//       const result = await model.generateContent({
//         contents: [{ role: "user", parts: [{ text: prompt }] }],
//       });
//       summaryText = result.response.text();
//     } catch (err) {
//       console.error("Gemini summarization error:", err);
//       summaryText = "Summary unavailable due to an internal error.";
//     }

//     // 5) save summary
//     await step.run("save-summary", async () => {
//       return db
//         .update(meetings)
//         .set({
//           summary: summaryText,
//           status: "completed",
//         })
//         .where(eq(meetings.id, event.data.meetingId))
//         .returning();
//     });
//   }
// );
