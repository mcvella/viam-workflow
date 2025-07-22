// Reexport your entry components here
import Cookies from "js-cookie";

let apiKeyId = "";
let apiKeySecret = "";
let host = "";
let machineId = "";

// Extract the machine identifier from the URL
const machineCookieKey = window.location.pathname.split("/")[2];
({
  apiKey: { id: apiKeyId, key: apiKeySecret },
  machineId: machineId,
  hostname: host,
} = JSON.parse(Cookies.get(machineCookieKey)!));