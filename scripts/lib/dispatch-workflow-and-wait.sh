#!/usr/bin/env bash

set -u

dispatch_workflow_and_wait() {
  local workflow="$1"
  local max_attempts="${2:-3}"
  local attempt before run_id

  for attempt in $(seq 1 "$max_attempts"); do
    before=$(gh run list --workflow "$workflow" --branch main --event workflow_dispatch \
      --json databaseId --limit 1 --jq '.[0].databaseId // 0')

    if ! gh workflow run "$workflow" --ref main; then
      echo "Dispatch of $workflow failed on attempt $attempt/$max_attempts." >&2
    else
      run_id=0
      for _ in $(seq 1 36); do
        sleep 5
        run_id=$(gh run list --workflow "$workflow" --branch main --event workflow_dispatch \
          --json databaseId --limit 1 --jq '.[0].databaseId // 0')
        [ "$run_id" != "0" ] && [ "$run_id" != "$before" ] && break
      done

      if [ "$run_id" != "0" ] && [ "$run_id" != "$before" ]; then
        echo "Watching $workflow run $run_id"
        if gh run watch "$run_id" --exit-status; then
          echo "$workflow succeeded on attempt $attempt/$max_attempts."
          return 0
        fi
      else
        echo "Dispatched $workflow run did not appear in time." >&2
      fi
    fi

    [ "$attempt" -lt "$max_attempts" ] && sleep 30
  done

  echo "$workflow did not complete successfully after $max_attempts attempts." >&2
  return 1
}
