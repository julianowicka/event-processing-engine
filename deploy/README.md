# Production Deployment

The production deployment runs alongside the existing Recruitment Tracker on
the OVH VPS. Caddy remains the only public entry point. The frontend joins
Caddy's existing `web` network and proxies `/api/*` to the API on an internal
Docker network. SQLite data is kept in the named `event_processing_database`
volume, outside the API container image.

## One-Time VPS Setup

Run the administrative steps on the VPS as `root`:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy /opt/apps/event-processing-engine
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Generate a dedicated SSH key on a trusted machine. Store its private key as
the GitHub Actions secret `VPS_SSH_PRIVATE_KEY` and append its public key to:

```text
/home/deploy/.ssh/authorized_keys
```

Create the runtime environment file on the VPS:

```bash
install -m 600 -o deploy -g deploy /dev/null /opt/apps/event-processing-engine/.env
```

Set its content to:

```env
CORS_ORIGIN=https://event-processing-engine.julianowicka.dev
EVENT_WORKER_INTERVAL_MS=1000
EVENT_WORKER_LOCK_TIMEOUT_MS=30000
EVENT_WORKER_VERBOSE_LOGS=false
EVENT_RETRY_DELAY_MS=10000
```

After adding `deploy` to the Docker group, its next SSH login will receive the
new group membership.

## GitHub Repository Settings

Configure the following Actions secrets:

```text
VPS_HOST=<public VPS IP address or hostname>
VPS_USER=deploy
VPS_SSH_PRIVATE_KEY=<private deployment SSH key>
VPS_KNOWN_HOSTS=<verified SSH host key line for the VPS>
```

Optionally configure this Actions variable:

```text
VPS_PORT=22
```

Obtain a candidate `VPS_KNOWN_HOSTS` entry from a trusted machine:

```bash
ssh-keyscan -H <VPS_HOST>
```

Verify its fingerprint against the VPS before saving it as a secret:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

## GHCR Images

A push to `main`, or a manual run of `Deploy to VPS`, creates:

```text
ghcr.io/julianowicka/event-processing-engine-api
ghcr.io/julianowicka/event-processing-engine-frontend
```

The first publication creates the packages privately. On GitHub, open each
package under the `julianowicka` profile, select `Package settings`, then use
`Change visibility` to make it public. This cannot later be changed back to
private. If the first deploy failed while pulling private images, rerun its
failed jobs after making both packages public.

## DNS And Caddy

In Porkbun, add this DNS record for `julianowicka.dev`:

```text
Type: A
Host: event-processing-engine
Answer: <public IPv4 address of the OVH VPS>
```

On the VPS, append this site to `/opt/apps/proxy/Caddyfile`, preserving the
existing Recruitment Tracker site:

```caddyfile
event-processing-engine.julianowicka.dev {
	reverse_proxy event-processing-frontend:80
}
```

Validate and reload the existing Caddy container:

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Verification And Rollback

After deployment:

```bash
curl -fsS https://event-processing-engine.julianowicka.dev/api/health
docker volume inspect event_processing_database
docker ps --filter name=event-processing
```

Confirm that `https://recruitment.julianowicka.dev` still responds and use the
new UI to enqueue an event. To roll back, run the production Compose file with
the previous known-good commit SHA:

```bash
cd /opt/apps/event-processing-engine
IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.prod.yml --env-file .env pull
IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans
```

Do not remove `event_processing_database`; it contains the SQLite database.
