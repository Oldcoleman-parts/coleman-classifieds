import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import {
  handleSesWebhook,
  setSnsFetch,
} from "@/modules/notifications/index.js";

describe("SNS webhook (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SNS_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789:ocp-ses";
  });

  afterEach(() => {
    setSnsFetch(null);
    delete process.env.SNS_TOPIC_ARN;
  });

  function buildSnsEnvelope({
    type,
    eventJson,
    version = "1",
    tamper = false,
  }) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = publicKey.export({ format: "pem", type: "spki" });

    const envelope = {
      Type: type,
      MessageId: "test-msg-1",
      TopicArn: process.env.SNS_TOPIC_ARN,
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify(eventJson),
      SignatureVersion: version,
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
    };

    const fields =
      type === "Notification"
        ? ["Message", "MessageId", "Timestamp", "TopicArn", "Type"]
        : [
            "Message",
            "MessageId",
            "SubscribeURL",
            "Timestamp",
            "TopicArn",
            "Type",
          ];

    let canonical = fields.map((f) => `${f}\n${envelope[f]}\n`).join("");
    if (tamper) {
      canonical = canonical.replace("Message", "TamperedMessage");
    }

    const sign = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256");
    sign.update(canonical, "utf8");
    envelope.Signature = sign.sign(privateKey, "base64");

    setSnsFetch(async () => pem);
    return envelope;
  }

  it("AC: permanent bounce creates EmailSuppression with reason BOUNCE", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(200);

    const suppression = await prisma.emailSuppression.findUnique({
      where: { email: "bounce@example.test" },
    });
    expect(suppression).toBeDefined();
    expect(suppression.reason).toBe("BOUNCE");
  });

  it("AC: complaint creates EmailSuppression with reason COMPLAINT", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Complaint",
        complaint: {
          complainedRecipients: [{ emailAddress: "complaint@example.test" }],
        },
      },
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(200);

    const suppression = await prisma.emailSuppression.findUnique({
      where: { email: "complaint@example.test" },
    });
    expect(suppression).toBeDefined();
    expect(suppression.reason).toBe("COMPLAINT");
  });

  it("AC: transient bounce (bounceType Transient) creates no suppression", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Transient",
          bouncedRecipients: [{ emailAddress: "transient@example.test" }],
        },
      },
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(200);

    const suppression = await prisma.emailSuppression.findUnique({
      where: { email: "transient@example.test" },
    });
    expect(suppression).toBeNull();
  });

  it("AC: duplicate delivery is harmless (still one row)", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    await handleSesWebhook(request);
    await handleSesWebhook(request);

    const count = await prisma.emailSuppression.count({
      where: { email: "bounce@example.test" },
    });
    expect(count).toBe(1);
  });

  it("AC: SignatureVersion 2 (RSA-SHA256) is supported", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
      version: "2",
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(200);
  });

  it("SEC: tampered Message after signing → 403", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
      tamper: true,
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);

    const suppression = await prisma.emailSuppression.findUnique({
      where: { email: "bounce@example.test" },
    });
    expect(suppression).toBeNull();
  });

  it("SEC: wrong TopicArn → 403", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });
    envelope.TopicArn = "arn:aws:sns:us-east-1:999999999:wrong";

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
  });

  it("SEC: SigningCertURL on non-amazonaws host → 403", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });
    envelope.SigningCertURL = "https://evil.example.test/cert.pem";

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
  });

  it("SEC: SigningCertURL like https://sns.us-east-1.amazonaws.com.evil.test/x.pem → 403", async () => {
    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });
    envelope.SigningCertURL =
      "https://sns.us-east-1.amazonaws.com.evil.test/cert.pem";

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
  });

  it("SEC: SNS_TOPIC_ARN unset → 403", async () => {
    delete process.env.SNS_TOPIC_ARN;

    const envelope = buildSnsEnvelope({
      type: "Notification",
      eventJson: {
        eventType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bounce@example.test" }],
        },
      },
    });

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
  });

  it("SEC: body is not JSON → 403", async () => {
    setSnsFetch(async () => "");
    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: "not json",
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
  });

  it("AC: SubscriptionConfirmation with valid signature fetches SubscribeURL once", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = publicKey.export({ format: "pem", type: "spki" });

    const envelope = {
      Type: "SubscriptionConfirmation",
      MessageId: "test-msg-1",
      TopicArn: process.env.SNS_TOPIC_ARN,
      Timestamp: new Date().toISOString(),
      Message: "subscribe",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm",
      Token: "test-token",
      SignatureVersion: "1",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
    };

    const fields = [
      "Message",
      "MessageId",
      "SubscribeURL",
      "Timestamp",
      "Token",
      "TopicArn",
      "Type",
    ];
    const canonical = fields.map((f) => `${f}\n${envelope[f]}\n`).join("");
    const sign = createSign("RSA-SHA1");
    sign.update(canonical, "utf8");
    envelope.Signature = sign.sign(privateKey, "base64");

    const fetchSpy = vi.fn(async (url) => {
      if (url === "https://sns.us-east-1.amazonaws.com/test.pem") return pem;
      return "";
    });
    setSnsFetch(fetchSpy);

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://sns.us-east-1.amazonaws.com/confirm",
    );
  });

  it("SEC: SubscribeURL on another host is not fetched", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = publicKey.export({ format: "pem", type: "spki" });

    const envelope = {
      Type: "SubscriptionConfirmation",
      MessageId: "test-msg-1",
      TopicArn: process.env.SNS_TOPIC_ARN,
      Timestamp: new Date().toISOString(),
      Message: "subscribe",
      SubscribeURL: "https://evil.example.test/confirm",
      Token: "test-token",
      SignatureVersion: "1",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
    };

    const fields = [
      "Message",
      "MessageId",
      "SubscribeURL",
      "Timestamp",
      "Token",
      "TopicArn",
      "Type",
    ];
    const canonical = fields.map((f) => `${f}\n${envelope[f]}\n`).join("");
    const sign = createSign("RSA-SHA1");
    sign.update(canonical, "utf8");
    envelope.Signature = sign.sign(privateKey, "base64");

    const fetchSpy = vi.fn(async () => pem);
    setSnsFetch(fetchSpy);

    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "POST",
      body: JSON.stringify(envelope),
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "https://evil.example.test/confirm",
    );
  });

  it("AC: GET → 405", async () => {
    const request = new Request("https://app.example.test/webhooks/ses", {
      method: "GET",
    });

    const response = await handleSesWebhook(request);
    expect(response.status).toBe(405);
  });
});
