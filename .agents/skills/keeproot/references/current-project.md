# Existing Project directory

Use this route when the user has provided and authorized an exact existing local directory. Registration records metadata; it does not move files, clean folders, grant authority over siblings, or prove earlier Host changes were protected by Atlas.

## Discover

Run `project resolve --path <authorized_directory> --json`. Continue file work only when `data.status` is `resolved` and its Project/location match the task. On `setup_required`, read remediation and `capabilities --json` for this installation. If `project register` is absent, report that the installed Runtime lacks noninteractive registration. Do not guess Project IDs, use internal registry/bootstrap commands, or simulate a desktop picker.

## Prepare

Write a request outside the governed directory:

```json
{
  "path": "<absolute authorized directory>",
  "name": "<display name>",
  "rootPolicy": "project_only",
  "requestKey": "<stable prepare key>",
  "caller": {
    "actor": "agent",
    "tool": "<Host>",
    "client_run_id": "<current run>"
  }
}
```

Call `project register prepare --request-file <request.json> --json`. Review the returned Project scope, Root strategy, existing identity and status. Default registration adopts exactly the selected folder if no containing Root exists; it does not silently adopt its parent. A containing Root already registered in Atlas does not extend the authority of this task.

## Execute and read back

After authorization matches the preview, use a separate request:

```json
{
  "expectedRevision": 1,
  "expectedDigest": "<digest from prepare>",
  "requestKey": "<stable execution key>",
  "caller": {
    "actor": "agent",
    "tool": "<Host>",
    "client_run_id": "<current run>"
  },
  "authorization": {
    "path": "<exact prepared Project directory>",
    "reason": "<user task authorizing registration>"
  }
}
```

Replace the example revision `1` with the JSON number returned by the current preview. Call `project register execute <registration_id> --request-file <execute.json> --json`, then `project resolve --path <directory> --json`. Use only the real returned Root/Project/location for subsequent `save` calls. Same-directory replay must retain the same identity; a different display name is not a rename authorization.

## Failure and recovery

Read `project register show <registration_id> --json` after interruption. Use `project register recover <registration_id> --request-file <bound-request.json> --json` only for its recorded pending operation, with the current revision/digest and original authorized directory. Stop on stale facts, linked/replaced paths or conflicting records. Keep the receipt and report the returned reason; never force registration or erase files. Metadata recovery does not undo a Host's previous cleanup script.
