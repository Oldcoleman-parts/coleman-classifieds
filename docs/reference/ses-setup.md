# Amazon SES setup

How to connect the app's email to Amazon SES. Done once per environment by whoever manages OCP's AWS account and DNS. The app never needs the AWS console; it only needs the values in step 7.

Use one AWS region for everything (for example `us-east-1`).

## 1. Verify the sending domain

1. In **SES → Identities → Create identity**, choose **Domain** and enter the sending domain (for example `oldcolemanparts.com`).
2. Keep **Easy DKIM** on (RSA 2048).
3. Tick **Use a custom MAIL FROM domain** and enter a subdomain such as `mail.oldcolemanparts.com`. Set "Behaviour on MX failure" to **Reject message**.

## 2. Add the DNS records

SES shows the exact values. Add them at the domain's DNS provider:

| Purpose   | Type  | Name                             | Value                                                |
| --------- | ----- | -------------------------------- | ---------------------------------------------------- |
| DKIM      | CNAME | three `<token>._domainkey` names | the three `<token>.dkim.amazonses.com` values        |
| MAIL FROM | MX    | `mail.oldcolemanparts.com`       | `10 feedback-smtp.<region>.amazonses.com`            |
| SPF       | TXT   | `mail.oldcolemanparts.com`       | `v=spf1 include:amazonses.com ~all`                  |
| DMARC     | TXT   | `_dmarc.oldcolemanparts.com`     | `v=DMARC1; p=none; rua=mailto:<a mailbox OCP reads>` |

- If the domain already has a DMARC record, keep it; don't add a second one.
- Start DMARC at `p=none`. Move to `quarantine` after a few weeks of clean reports.
- Wait until the identity shows **Verified** and DKIM shows **Successful** (minutes to a few hours).

## 3. Create the two configuration sets

**SES → Configuration sets → Create set**, twice:

- `transactional`: staff notices, reminders and other one-to-one email.
- `alerts`: the subscriber emails (confirmation and daily digest).

Two sets keep the reputation of the two kinds of email apart and let SES pause one without the other.

## 4. Send bounces and complaints to the app

1. **SNS → Topics → Create topic**, type **Standard**, name `classifieds-ses-events`. Copy its ARN.
2. In **each** configuration set: **Event destinations → Add destination**. Tick **Hard bounces**, **Complaints**, **Rejects** and **Rendering failures**. Destination type **Amazon SNS**, and pick the topic.
3. After the app is deployed: **SNS → the topic → Create subscription**. Protocol **HTTPS**, endpoint `https://<app URL>/webhooks/ses`. Leave **raw message delivery off**.
4. The app confirms the subscription by itself. The subscription should show **Confirmed** within a minute. If it stays pending, check that `SNS_TOPIC_ARN` is set to this topic's ARN (the app answers 403 to any other topic) and use **Request confirmation**.

## 5. Ask for production access

A new SES account is in the **sandbox**: it only sends to verified addresses, at most 200 a day.

**SES → Account dashboard → Request production access.** Mail type **Transactional**. Describe the use: invite-only classifieds, staff notices and seller reminders, a double opt-in daily digest with one-click unsubscribe, and bounces and complaints suppressed automatically. Approval usually takes about a day. Ask early.

Until then, verify your own address under **Identities** and send to that.

## 6. Create the app's credentials

Create an IAM user (or a role, if the host supports one) with only this policy. Replace the region, account id and domain.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": [
        "arn:aws:ses:<region>:<account-id>:identity/oldcolemanparts.com",
        "arn:aws:ses:<region>:<account-id>:configuration-set/transactional",
        "arn:aws:ses:<region>:<account-id>:configuration-set/alerts"
      ]
    }
  ]
}
```

The photo storage permissions for the same user are in `s3-cloudfront-setup.md`, step 6.

## 7. Set the environment variables

Set these in `.env` locally and in the host's variables. Never commit them.

| Variable                                     | Value                                                               |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `AWS_REGION`                                 | the region used above                                               |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the IAM user's key (not needed with a role)                         |
| `SES_FROM_TRANSACTIONAL`                     | for example `classifieds@oldcolemanparts.com`                       |
| `SES_FROM_ALERTS`                            | for example `alerts@oldcolemanparts.com`                            |
| `SES_CONFIG_SET_TRANSACTIONAL`               | `transactional`                                                     |
| `SES_CONFIG_SET_ALERTS`                      | `alerts`                                                            |
| `SNS_TOPIC_ARN`                              | the topic's ARN from step 4                                         |
| `OCP_POSTAL_ADDRESS`                         | OCP's postal address, shown in the footer of alert emails           |
| `SHOP_DOMAIN`                                | the store's `myshopify.com` domain, used for links in staff notices |

Both sender addresses must be on the verified domain. Until the sender and configuration set of a stream are set, its emails wait in the queue instead of failing.

## 8. Check it works

SES has a mailbox simulator that costs nothing and doesn't hurt reputation. In the app, open **Settings → Emails**, choose any email (not one of the two alert emails) and use **Send a test to**:

1. Your own address: it should arrive within a minute. While SES is in the sandbox, verify that address under **Identities** first. Check the headers in your mailbox: `dkim=pass`, `spf=pass`, `dmarc=pass`.
2. `success@simulator.amazonses.com`: the screen says the test was sent.
3. `bounce@simulator.amazonses.com`: within a minute the address is in the suppression list (`EmailSuppression`), and a second test to it says the address is blocked.
4. `complaint@simulator.amazonses.com`: the same.

Steps 3 and 4 need the SNS subscription from section 4, so they work on a deployed app, not on a local tunnel that changes address.

## How the app uses this

- Every email is checked against the suppression list, queued, and tried at once. If SES is unavailable it is retried by the hourly job for about a day.
- A hard bounce or a complaint adds the address to the suppression list for good.
- A send that fails for good, or a bounce rate above 5% or complaint rate above 0.1% in a day, is recorded as an email problem. Problem alerts by email arrive with F08.
