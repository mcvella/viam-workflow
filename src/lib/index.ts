// Reexport your entry components here
import Cookies from "js-cookie";
import { createViamClient } from "@viamrobotics/sdk";

let apiKeyId = "";
let apiKeySecret = "";
let host = "";
let machineId = "";
let viamClient: any = null;

// Only run this code in the browser
if (typeof window !== 'undefined') {
  try {
    // Extract the machine identifier from the URL
    const machineCookieKey = window.location.pathname.split("/")[2];
    console.log("Machine cookie key:", machineCookieKey);
    
    const cookieData = Cookies.get(machineCookieKey);
    console.log("Raw cookie data:", cookieData);
    
    if (!cookieData) {
      console.error("No cookie data found for key:", machineCookieKey);
      throw new Error("No cookie data found");
    }
    
    const parsedData = JSON.parse(cookieData);
    console.log("Parsed cookie data:", parsedData);
    
    // Safely extract the data with fallbacks
    apiKeyId = parsedData?.apiKey?.id || "";
    apiKeySecret = parsedData?.apiKey?.key || "";
    machineId = parsedData?.machineId || "";
    host = parsedData?.hostname || "";
    
    console.log("Extracted credentials:", {
      apiKeyId,
      apiKeySecret: apiKeySecret ? "***" : "not found",
      machineId,
      host
    });

    if (!apiKeySecret || !host) {
      console.error("Missing required credentials");
      throw new Error("Missing API key or hostname");
    }

    console.log("Creating Viam client");

    // Create Viam client with the API credentials
    const clientConfig = {
      serviceHost: "https://app.viam.com",
      credentials: {
        authEntity: apiKeyId,
        type: 'api-key' as const,
        payload: apiKeySecret
      }
    };
    
    console.log("Client config:", {
      serviceHost: clientConfig.serviceHost,
      credentialType: clientConfig.credentials.type,
      hasPayload: !!clientConfig.credentials.payload,
      authEntity: clientConfig.credentials.authEntity
    });
    
    // Try creating client with correct format
    try {
      viamClient = await createViamClient(clientConfig);
      console.log("Viam client created successfully:", viamClient);
    } catch (error) {
      console.error("Failed to create client:", error);
      
      // Try alternative service host
      try {
        const altConfig = {
          serviceHost: "https://app.viam.com:443",
          credentials: {
            authEntity: apiKeyId,
            type: 'api-key' as const,
            payload: apiKeySecret
          }
        };
        
        console.log("Trying alternative config:", {
          serviceHost: altConfig.serviceHost,
          authEntity: altConfig.credentials.authEntity
        });
        
        viamClient = await createViamClient(altConfig);
        console.log("Viam client created with alternative config:", viamClient);
      } catch (error2) {
        console.error("Failed to create client with alternative config:", error2);
        throw error2;
      }
    }
  } catch (error) {
    console.error("Error creating Viam client:", error);
  }
}

// Export the Viam client for use in the application
export { viamClient };