import {
  clearSessionCookie,
  redirectResponse
} from "../../../_admin-auth.js";

export function onRequest() {
  return redirectResponse("/admin/", {
    "Set-Cookie": clearSessionCookie()
  });
}
