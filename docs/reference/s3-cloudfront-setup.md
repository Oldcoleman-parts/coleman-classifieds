# Amazon S3 and CloudFront setup

How to connect the app's photo storage. Done once per environment by whoever manages OCP's AWS account. The app never creates buckets or distributions; it only needs the values in step 7.

Use the same AWS region as SES for the bucket (for example `us-east-1`).

## How photos move

| Prefix      | What is in it                                             | Who can read it                               |
| ----------- | --------------------------------------------------------- | --------------------------------------------- |
| `incoming/` | the file exactly as the browser uploaded it               | nobody; the app reads it once and deletes it  |
| `private/`  | the cleaned JPEG (no EXIF or GPS) of every stored photo   | the app, and 10-minute links for seller/staff |
| `public/`   | three sizes of each photo of a live listing, random names | everyone, **through CloudFront only**         |

## 1. Create the bucket

**S3 → Create bucket.**

- Name: for example `ocp-classifieds-photos-prod` (one bucket per environment).
- **Object Ownership:** ACLs disabled (bucket owner enforced).
- **Block Public Access:** leave **all four** settings on. They stay on for good.
- **Bucket Versioning:** enable.
- **Default encryption:** SSE-S3 (the default).

## 2. Add the lifecycle rules

**Bucket → Management → Create lifecycle rule**, twice:

1. `expire-incoming`: prefix `incoming/`. **Expire current versions** after **1 day**, **permanently delete noncurrent versions** after **1 day**, and **delete incomplete multipart uploads** after 1 day. This clears uploads that were never finished.
2. `expire-old-versions`: whole bucket. **Permanently delete noncurrent versions** after **30 days**. A deleted or replaced photo can be recovered for 30 days, then it is gone.

## 3. Allow browser uploads (CORS)

**Bucket → Permissions → CORS.** Replace the origins with the storefront and the app's URL.

```json
[
  {
    "AllowedOrigins": [
      "https://oldcolemanparts.com",
      "https://admin.shopify.com",
      "https://<app URL>"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

**Local development:** `shopify app dev` serves the app from a Cloudflare tunnel whose address changes on every start, so add `"https://*.trycloudflare.com"` to the dev bucket's origins (S3 allows one `*` per origin). Without it, staff photo uploads fail with “The photo could not be uploaded” and a CORS error in the browser console. Never put the wildcard on the production bucket: list the exact Railway app URL there.

Only `PUT` is needed: the browser uploads to a signed link. Photos are shown from CloudFront or from signed links, which need no CORS.

## 4. Create the CloudFront distribution

**CloudFront → Create distribution.**

- **Origin domain:** the bucket (pick the S3 bucket, not the "website endpoint").
- **Origin access:** **Origin access control settings (recommended)** → create a new OAC, signing behaviour **Sign requests**.
- **Viewer protocol policy:** Redirect HTTP to HTTPS. **Allowed methods:** GET, HEAD.
- **Cache policy:** CachingOptimized. Public photo names never change, so they can be cached for a long time.
- **Default root object:** leave empty.
- Web application firewall: optional.

Copy the distribution's **domain name** (`dxxxxxxxx.cloudfront.net`) and **ID**. A custom domain such as `photos.oldcolemanparts.com` is optional; it needs an ACM certificate in `us-east-1` and a DNS CNAME.

## 5. Let CloudFront read `public/` only

**Bucket → Permissions → Bucket policy.** Replace the bucket name, account id and distribution id. Note the resource: it is `public/*`, not the whole bucket.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFrontReadsPublicOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/public/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<account-id>:distribution/<distribution-id>"
        }
      }
    }
  ]
}
```

CloudFront offers to "copy policy" after you create the OAC. Its version allows the whole bucket: change the resource to `/public/*` before saving.

## 6. Give the app its permissions

Add this policy to the IAM user (or role) created in `ses-setup.md`, step 6. It is the least the app needs, per prefix.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UploadsAndCleanup",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/incoming/*"
    },
    {
      "Sid": "StoredPhotos",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/private/*"
    },
    {
      "Sid": "PublicCopies",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/public/*"
    },
    {
      "Sid": "ClearCdnCache",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<account-id>:distribution/<distribution-id>"
    }
  ]
}
```

The app has no `s3:ListBucket`, no bucket-level rights and no access to object versions. Upload and preview links are signed with these same credentials, so a link can never do more than this policy allows.

## 7. Set the environment variables

Set these in `.env` locally and in the host's variables. Never commit them.

| Variable                                     | Value                                                             |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `AWS_REGION`                                 | the bucket's region (the same one SES uses)                       |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the IAM user's key (not needed with a role)                       |
| `S3_BUCKET`                                  | the bucket name                                                   |
| `CLOUDFRONT_DOMAIN`                          | `dxxxxxxxx.cloudfront.net` or the custom domain, without https:// |
| `CLOUDFRONT_DISTRIBUTION_ID`                 | the distribution ID                                               |

Until all three photo values are set, photo functions fail with "Photo storage is not configured"; the rest of the app works.

## 8. Check it works

Record the result on the ticket (F03-T2). Steps 1–3 need the seller screens from F04 or a photo put in place by hand.

1. Upload a phone photo that has location data. Download the stored file from `private/` in the console and check it has no EXIF (for example with `exiftool`).
2. **Private stays private:** open `https://<bucket>.s3.<region>.amazonaws.com/private/<any key>` in a browser. It must answer **403 Access Denied**. Do the same for a `public/` key on the S3 address: also **403**.
3. **CloudFront serves public only:** `https://<CLOUDFRONT_DOMAIN>/public/<key>_large.jpg` shows the photo; `https://<CLOUDFRONT_DOMAIN>/private/<key>` answers **403**.
4. Close or remove the listing: within a minute or two the CloudFront address answers 403 or 404.
5. In **IAM → Policy simulator**, confirm the app's user is denied `s3:ListBucket` and `s3:GetObject` on `public/*`.

## How the app uses this

- An upload link works for 10 minutes, for one object under `incoming/<listing>/`, and only for the stated type and size (at most 15 MB).
- The app reads the upload, checks it really is a photo, converts HEIC, re-encodes it as a JPEG without metadata and stores that in `private/`. The upload is deleted.
- When a listing goes live, three sizes of each photo are written to `public/` under new random names. When it closes, they are deleted and CloudFront is told to forget them.
- A deleted photo is removed from `private/` at once. Photos of a closed listing are removed 90 days after it closed (Settings: photo retention).
