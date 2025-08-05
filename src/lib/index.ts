// Reexport your entry components here
import Cookies from "js-cookie";
import { createViamClient } from "@viamrobotics/sdk";
import { Struct } from "@bufbuild/protobuf";

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

// Function to get machine config and find event managers
async function getMachineConfig() {
  if (!viamClient || !machineId) {
    console.error("Viam client or machine ID not available");
    return null;
  }

  try {
    console.log("Getting robot parts for machine:", machineId);
    const robotParts = await viamClient.appClient.getRobotParts(machineId);
    console.log("Robot parts:", robotParts);

    // Find the main part
    const mainPart = robotParts.find((part: any) => part.mainPart);
    if (!mainPart) {
      console.error("No main part found for machine:", machineId);
      return null;
    }

    console.log("Main part:", mainPart);
    console.log("Getting robot part config for:", mainPart.id);
    
    const robotPart = await viamClient.appClient.getRobotPart(mainPart.id);
    console.log("Robot part config:", robotPart);

    // Parse the configJson to get the actual config
    let parsedConfig = {};
    if (robotPart.configJson) {
      try {
        parsedConfig = JSON.parse(robotPart.configJson);
        console.log("Parsed config:", parsedConfig);
      } catch (parseError) {
        console.error("Error parsing configJson:", parseError);
        console.log("Raw configJson:", robotPart.configJson);
      }
    }

    return {
      ...robotPart,
      config: parsedConfig
    };
  } catch (error) {
    console.error("Error getting machine config:", error);
    return null;
  }
}

// Function to find event manager configurations
function findEventManagers(config: any) {
  const eventManagers: any[] = [];
  
  if (!config || !config.config) {
    return eventManagers;
  }

  const robotConfig = config.config;
  
  // Look for event_manager components in the config
  if (robotConfig.components && Array.isArray(robotConfig.components)) {
    robotConfig.components.forEach((component: any) => {
      if (component.model === "viam:event-manager:eventing") {
        eventManagers.push({
          name: component.name,
          config: component.attributes
        });
      }
    });
  }

  return eventManagers;
}

// Function to save event manager configuration
async function saveEventManager(eventManagerName: string, eventManagerConfig: any, originalName?: string) {
  if (!viamClient || !machineId) {
    console.error("Viam client or machine ID not available");
    throw new Error("Viam client or machine ID not available");
  }

  try {
    console.log("=== SAVE EVENT MANAGER DEBUG ===");
    console.log("Event manager name:", eventManagerName);
    console.log("Original name (if editing):", originalName);
    console.log("Event manager config:", eventManagerConfig);
    
    console.log("Getting current machine config...");
    const machineConfig = await getMachineConfig();
    
    if (!machineConfig) {
      throw new Error("Failed to get machine configuration");
    }

    console.log("Original machine config:", machineConfig);
    console.log("Original machine config type:", typeof machineConfig);
    console.log("Original machine config keys:", Object.keys(machineConfig));

    // Find the main part
    const robotParts = await viamClient.appClient.getRobotParts(machineId);
    const mainPart = robotParts.find((part: any) => part.mainPart);
    
    if (!mainPart) {
      throw new Error("No main part found for machine");
    }

    console.log("Main part:", mainPart);

    // Get the current full robot configuration
    const currentRobotConfig = machineConfig.config;
    console.log("Current robot config:", currentRobotConfig);
    console.log("Current robot config type:", typeof currentRobotConfig);
    console.log("Current robot config keys:", currentRobotConfig ? Object.keys(currentRobotConfig) : 'null/undefined');
    console.log("Current robot config components:", currentRobotConfig?.components);
    console.log("Current robot config modules:", currentRobotConfig?.modules);
    console.log("Current robot config services:", currentRobotConfig?.services);

    // Create a deep copy of the current config, or start with empty config if none exists
    let updatedConfig;
    if (currentRobotConfig && typeof currentRobotConfig === 'object') {
      try {
        // Try to convert to a plain object first
        const plainConfig = JSON.parse(JSON.stringify(currentRobotConfig));
        updatedConfig = plainConfig;
        console.log("Successfully created deep copy of existing config");
        console.log("Deep copied config:", updatedConfig);
        console.log("Deep copied config components:", updatedConfig.components);
        console.log("Deep copied config modules:", updatedConfig.modules);
        console.log("Deep copied config services:", updatedConfig.services);
      } catch (parseError) {
        console.error("Error parsing existing config:", parseError);
        console.log("Falling back to manual copy");
        // Fallback: manually copy the config
        updatedConfig = { ...currentRobotConfig };
        if (currentRobotConfig.services) {
          updatedConfig.services = { ...currentRobotConfig.services };
        }
        if (currentRobotConfig.components) {
          updatedConfig.components = { ...currentRobotConfig.components };
        }
        console.log("Manually copied config:", updatedConfig);
      }
    } else {
      console.log("No existing robot config found, creating new one");
      updatedConfig = {};
    }
    
    // Initialize components if it doesn't exist
    if (!updatedConfig.components) {
      updatedConfig.components = [];
    }

    // Initialize modules if it doesn't exist
    if (!updatedConfig.modules) {
      updatedConfig.modules = [];
    }

    console.log("Before adding event manager - updatedConfig:", updatedConfig);
    console.log("Before adding event manager - components:", updatedConfig.components);
    console.log("Before adding event manager - modules:", updatedConfig.modules);

    // Determine which name to use for finding existing component
    const searchName = originalName || eventManagerName;
    
    // Check if event manager already exists
    const existingComponentIndex = updatedConfig.components.findIndex((component: any) => 
      component.name === searchName
    );

    const eventManagerComponent = {
      name: eventManagerName,
      api: "rdk:component:sensor",
      model: "viam:event-manager:eventing",
      attributes: eventManagerConfig
    };

    if (existingComponentIndex >= 0) {
      // Update existing event manager
      console.log("Updating existing event manager at index:", existingComponentIndex);
      updatedConfig.components[existingComponentIndex] = eventManagerComponent;
    } else {
      // Add new event manager
      console.log("Adding new event manager");
      updatedConfig.components.push(eventManagerComponent);
    }

    // Add the event manager module if it doesn't exist
    const eventManagerModule = {
      type: "registry",
      name: "viam_event-manager",
      module_id: "viam:event-manager",
      version: "latest"
    };
    
    // Check if the module already exists
    const moduleExists = updatedConfig.modules.some((module: any) => 
      module.module_id === "viam:event-manager"
    );
    
    if (!moduleExists) {
      updatedConfig.modules.push(eventManagerModule);
    }

    console.log("After adding/updating event manager - updatedConfig:", updatedConfig);
    console.log("After adding/updating event manager - components:", updatedConfig.components);
    console.log("After adding/updating event manager - modules:", updatedConfig.modules);

    // Update the robot part with just the configuration
    // The API expects: updateRobotPart(id, name, robotConfig: Struct)
    console.log("Calling updateRobotPart with:");
    console.log("- mainPart.id:", mainPart.id);
    console.log("- mainPart.name:", mainPart.name);
    console.log("- robotConfig:", updatedConfig);

    const updateResult = await viamClient.appClient.updateRobotPart(
      mainPart.id,
      mainPart.name,
      Struct.fromJson(updatedConfig)
    );

    console.log("Update result:", updateResult);

    // Verify the update by fetching the config again
    console.log("Verifying update by fetching config again...");
    const verifyConfig = await getMachineConfig();
    console.log("Verified config after update:", verifyConfig);

    console.log("Event manager saved successfully");
    return true;
  } catch (error) {
    console.error("Error saving event manager:", error);
    throw error;
  }
}

// Export the Viam client and helper functions for use in the application
export { viamClient, getMachineConfig, findEventManagers, saveEventManager };