# BB document review

This fixture exercises the native Plannotator review panel.

## First milestone

- Open a Markdown document from the thread's working folder.
- Select text and attach a review comment.
- Add feedback to the composer or send it to the associated agent.
- Approve the exact document version and refresh after an agent reply.

## Acceptance criteria

Review comments survive closing and reopening the panel. Feedback names the
document and reviewed content hash. Approval confirms only the reviewed document
version; it does not authorize implementation or advancement to another stage.
After approval, the agent acknowledges it and waits for the user's next request.

## Rendering checks

```typescript
const review = { approved: true, implementationAuthorized: false };
```

```mermaid
flowchart LR
  Review --> Feedback --> Revision
```
