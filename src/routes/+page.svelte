<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState, goto } from '$app/navigation';
  import { viamClient, getMachineConfig, findEventManagers, saveEventManager } from '../lib/index.js';
  import resourceMethods from '../lib/resource_methods.json' with { type: 'json' };

  console.log("Svelte component loaded, viamClient:", viamClient);

  // Get the event manager name from query parameter
  $: editEventManagerName = typeof window !== 'undefined' ? $page.url.searchParams.get('edit') : null;

  // Auto-open editing form if edit parameter is provided
  $: if (typeof window !== 'undefined' && editEventManagerName && eventManagers.length > 0 && !showEventManagerForm && !editingEventManager && !isClosingForm) {
    console.log("Reactive statement triggered!");
    console.log("editEventManagerName:", editEventManagerName);
    console.log("eventManagers.length:", eventManagers.length);
    console.log("showEventManagerForm:", showEventManagerForm);
    console.log("editingEventManager:", editingEventManager);
    console.log("isClosingForm:", isClosingForm);
    
    const eventManagerToEdit = eventManagers.find(em => em.name === editEventManagerName);
    if (eventManagerToEdit) {
      console.log("Opening form for event manager:", eventManagerToEdit.name);
      openEventManagerForm(eventManagerToEdit);
    }
  }

  interface Rule {
    type: 'detection' | 'classification' | 'tracker' | 'time' | 'call';
    camera?: string;
    detector?: string;
    classifier?: string;
    tracker?: string;
    class_regex?: string;
    confidence_pct?: number;
    ranges?: Array<{start_hour: number, end_hour: number}>;
    resource?: string;
    method?: string;
    payload?: string;
    result_path?: string;
    result_function?: string;
    result_operator?: string;
    result_value?: string;
    inverse_pause_secs?: number;
    pause_on_known_secs?: number;
    extra?: Record<string, any>;
  }

  interface Notification {
    type: 'sms' | 'email' | 'webhook_get' | 'push';
    preset?: string;
    to?: string[];
    include_image?: boolean;
    url?: string;
    fcm_tokens?: string[];
  }

  // Separate interface for the 'add notification' form to handle string inputs
  interface NewNotification {
    type: 'sms' | 'email' | 'webhook_get' | 'push';
    preset?: string;
    to?: string;
    include_image?: boolean;
    url?: string;
    fcm_tokens?: string;
  }

  interface Action {
    resource: string;
    method: string;
    payload: string;
    response_match?: string;
    when_secs: number;
  }

  interface Event {
    name: string;
    modes?: string[];
    pause_alerting_on_event_secs: number;
    detection_hz: number;
    rule_logic_type: 'AND' | 'OR' | 'XOR' | 'NOR' | 'NAND' | 'XNOR';
    trigger_sequence_count: number;
    require_rule_reset?: boolean;
    rule_reset_count?: number;
    notifications: Notification[];
    actions: Action[];
    rules: Rule[];
    capture_video?: boolean;
    video_capture_resource?: string;
    event_video_capture_padding_secs?: number;
  }

  interface EventManager {
    name: string;
    mode?: string;
    mode_override: {
      mode: string;
      until: string;
    };
    back_state_to_disk?: boolean;
    data_directory?: string;
    app_api_key?: string;
    app_api_key_id?: string;
    email_module?: string;
    sms_module?: string;
    push_module?: string;
    resources?: Record<string, {type: string, subtype: string}>;
    events: Event[];
    enable_backoff_schedule?: boolean;
    backoff_schedule?: Record<string, number>;
  }

  let config: EventManager = {
    name: '',
    events: [],
    mode_override: { mode: '', until: '' },
  };

  let showAddRule = false;
  let showAddNotification = false;
  let showAddAction = false;
  let newRule: Rule = { type: 'detection' };
  let newNotification: NewNotification = { type: 'sms' };
  let newAction: Action = { resource: '', method: '', payload: '', when_secs: 0 };

  // New state for event manager management
  let loading = true;
  let error = '';
  let eventManagers: any[] = [];
  let showEventManagerForm = false;
  let editingEventManager: any = null;
  let saving = false;
  let saveError = '';
  let machineComponents: any[] = [];

  // Backoff schedule text for JSON editing
  let backoffScheduleText = '';

  // Advanced settings visibility
  let showAdvancedSettings = false;

  // Event editing state
  let editingEventIndex: number | null = null;
  let editingEvent: Event | null = null;
  let eventModesText = '';

  // Event-specific form states
  let showAddEventRule = false;
  let showAddEventNotification = false;
  let showAddEventAction = false;

  // Edit existing items states
  let editingRuleIndex: number | null = null;
  let editingNotificationIndex: number | null = null;
  let editingActionIndex: number | null = null;
  let editingRule: Rule | null = null;
  let editingNotification: Notification | null = null;
  let editingAction: Action | null = null;
  let showEditEventRule = false;
  let showEditEventNotification = false;
  let showEditEventAction = false;

  // Flag to prevent reactive statement from re-opening form during close
  let isClosingForm = false;

  // Reactive lists for dropdowns
  $: cameras = machineComponents.filter(c => c.api.startsWith('rdk:component:camera')).map(c => c.name);
  $: visionServices = machineComponents.filter(c => 
    c.api.startsWith('rdk:service:vision') || 
    c.api.includes('vision') ||
    c.api.includes('detector') ||
    c.api.includes('classifier') ||
    c.api.includes('tracker')
  ).map(c => c.name);
  $: allResources = machineComponents.map(c => c.name);

  $: {
    console.log('Machine components:', machineComponents);
    console.log('Machine components APIs:', machineComponents.map(c => ({ name: c.name, api: c.api })));
    console.log('Cameras:', cameras);
    console.log('Vision services:', visionServices);
  }

  $: callRuleApi = machineComponents.find(c => c.name === newRule.resource)?.api;
  $: callRuleMethods = (() => {
    if (!callRuleApi) return [];
    const methodsKey = Object.keys(resourceMethods).find(key => callRuleApi.startsWith(key));
    if (!methodsKey) return [];
    return (resourceMethods as Record<string, string[]>)[methodsKey] || [];
  })();

  $: actionApi = machineComponents.find(c => c.name === newAction.resource)?.api;
  $: actionMethods = (() => {
    if (!actionApi) return [];
    const methodsKey = Object.keys(resourceMethods).find(key => actionApi.startsWith(key));
    if (!methodsKey) return [];
    return (resourceMethods as Record<string, string[]>)[methodsKey] || [];
  })();

  $: {
    if (callRuleApi) {
      console.log(`Resource: ${newRule.resource}, API: ${callRuleApi}, Methods:`, callRuleMethods);
    }
    if (actionApi) {
      console.log(`Action Resource: ${newAction.resource}, API: ${actionApi}, Methods:`, actionMethods);
    }
  }

  // Auto-manage resources based on rules and actions
  $: {
    const autoResources: Record<string, {type: string, subtype: string}> = {};
    
    // Add resources from rules
    config.events.forEach(event => {
      if (event.rules && Array.isArray(event.rules)) {
        event.rules.forEach(rule => {
          if (rule.camera) {
            const component = machineComponents.find(c => c.name === rule.camera);
            if (component) {
              autoResources[rule.camera] = {
                type: 'component',
                subtype: component.api.split(':')[2] || 'camera'
              };
            }
          }
          if (rule.detector || rule.classifier || rule.tracker) {
            const serviceName = rule.detector || rule.classifier || rule.tracker;
            if (serviceName) {
              const service = machineComponents.find(c => c.name === serviceName);
              if (service) {
                autoResources[serviceName] = {
                  type: 'service',
                  subtype: service.api.split(':')[2] || 'vision'
                };
              }
            }
          }
          if (rule.resource) {
            const component = machineComponents.find(c => c.name === rule.resource);
            if (component) {
              autoResources[rule.resource] = {
                type: 'component',
                subtype: component.api.split(':')[2] || 'generic'
              };
            }
          }
        });
      }
    });
    
    // Add resources from actions
    config.events.forEach(event => {
      if (event.actions && Array.isArray(event.actions)) {
        event.actions.forEach(action => {
          if (action.resource) {
            const component = machineComponents.find(c => c.name === action.resource);
            if (component) {
              autoResources[action.resource] = {
                type: 'component',
                subtype: component.api.split(':')[2] || 'generic'
              };
            }
          }
        });
      }
    });
    
    config.resources = autoResources;
  }

  onMount(async () => {
    if (viamClient) {
      try {
        console.log("Loading machine config...");
        const machineConfig = await getMachineConfig();
        
        if (machineConfig) {
          console.log("Machine config loaded:", machineConfig);
          eventManagers = findEventManagers(machineConfig);
          const components = machineConfig.config?.components || [];
          const services = machineConfig.config?.services || [];
          machineComponents = [...components, ...services];
          console.log("Found event managers:", eventManagers);
          console.log("Found machine components:", machineComponents);
          console.log("Machine config structure:", {
            components: components.length,
            services: services.length,
            modules: machineConfig.config?.modules?.length || 0
          });
        } else {
          error = "Failed to load machine configuration";
        }
      } catch (err) {
        console.error("Error loading machine config:", err);
        error = "Error loading machine configuration";
      } finally {
        loading = false;
      }
    } else {
      error = "Viam client not available";
      loading = false;
    }
  });

  function openEventManagerForm(eventManager?: any) {
    if (eventManager) {
      // Load existing config
      editingEventManager = eventManager;
      config = {
        name: eventManager.name,
        mode: eventManager.config.mode,
        mode_override: eventManager.config.mode_override || { mode: '', until: '' },
        back_state_to_disk: eventManager.config.back_state_to_disk,
        data_directory: eventManager.config.data_directory,
        app_api_key: eventManager.config.app_api_key,
        app_api_key_id: eventManager.config.app_api_key_id,
        email_module: eventManager.config.email_module,
        sms_module: eventManager.config.sms_module,
        push_module: eventManager.config.push_module,
        resources: eventManager.config.resources || {},
        events: (eventManager.config.events || []).map(event => ({
          ...event,
          rules: event.rules || [],
          notifications: event.notifications || [],
          actions: event.actions || [],
        })),
        enable_backoff_schedule: eventManager.config.enable_backoff_schedule,
        backoff_schedule: eventManager.config.backoff_schedule || {},
      };
    } else {
      // Create new config
      editingEventManager = null;
      config = {
        name: '',
        events: [],
        mode_override: { mode: '', until: '' },
        enable_backoff_schedule: false,
        backoff_schedule: {},
      };
    }
    showEventManagerForm = true;
    saveError = '';
    // Initialize backoff schedule text
    backoffScheduleText = JSON.stringify(config.backoff_schedule || {}, null, 2);
  }

  function addEvent() {
    const newEvent: Event = {
      name: `Event ${config.events.length + 1}`,
      modes: ['active'],
      pause_alerting_on_event_secs: 300,
      detection_hz: 5,
      rule_logic_type: 'AND',
      trigger_sequence_count: 1,
      require_rule_reset: false,
      rule_reset_count: 1,
      notifications: [],
      actions: [],
      rules: [],
    };
    config.events = [...config.events, newEvent];
    
    // Automatically open the edit form for the newly created event
    const newEventIndex = config.events.length - 1;
    editEvent(newEventIndex);
  }

  function removeEvent(index: number) {
    config.events = config.events.filter((_, i) => i !== index);
  }

  function editEvent(eventIndex: number) {
    editingEventIndex = eventIndex;
    editingEvent = { ...config.events[eventIndex] };
    eventModesText = editingEvent.modes?.join(', ') || '';
  }

  function saveEvent() {
    if (editingEventIndex !== null && editingEvent) {
      // Convert modes text back to array
      editingEvent.modes = eventModesText.split(',').map(s => s.trim()).filter(Boolean);
      config.events[editingEventIndex] = { ...editingEvent };
      closeEventEdit();
    }
  }

  function closeEventEdit() {
    editingEventIndex = null;
    editingEvent = null;
  }

  function removeEventRule(ruleIndex: number) {
    if (editingEvent) {
      editingEvent.rules = editingEvent.rules.filter((_, i) => i !== ruleIndex);
    }
  }

  function removeEventNotification(notifIndex: number) {
    if (editingEvent) {
      editingEvent.notifications = editingEvent.notifications.filter((_, i) => i !== notifIndex);
    }
  }

  function removeEventAction(actionIndex: number) {
    if (editingEvent) {
      editingEvent.actions = editingEvent.actions.filter((_, i) => i !== actionIndex);
    }
  }

  function editEventRule(ruleIndex: number) {
    if (editingEvent) {
      editingRuleIndex = ruleIndex;
      editingRule = { ...editingEvent.rules[ruleIndex] };
      showEditEventRule = true;
    }
  }

  function editEventNotification(notifIndex: number) {
    if (editingEvent) {
      editingNotificationIndex = notifIndex;
      editingNotification = { ...editingEvent.notifications[notifIndex] };
      showEditEventNotification = true;
    }
  }

  function editEventAction(actionIndex: number) {
    if (editingEvent) {
      editingActionIndex = actionIndex;
      editingAction = { ...editingEvent.actions[actionIndex] };
      showEditEventAction = true;
    }
  }

  function saveEventRule() {
    if (editingRuleIndex !== null && editingRule && editingEvent) {
      editingEvent.rules[editingRuleIndex] = { ...editingRule };
      closeEventRuleEdit();
    }
  }

  function saveEventNotification() {
    if (editingNotificationIndex !== null && editingNotification && editingEvent) {
      editingEvent.notifications[editingNotificationIndex] = { ...editingNotification };
      closeEventNotificationEdit();
    }
  }

  function saveEventAction() {
    if (editingActionIndex !== null && editingAction && editingEvent) {
      editingEvent.actions[editingActionIndex] = { ...editingAction };
      closeEventActionEdit();
    }
  }

  function closeEventRuleEdit() {
    editingRuleIndex = null;
    editingRule = null;
    showEditEventRule = false;
  }

  function closeEventNotificationEdit() {
    editingNotificationIndex = null;
    editingNotification = null;
    showEditEventNotification = false;
  }

  function closeEventActionEdit() {
    editingActionIndex = null;
    editingAction = null;
    showEditEventAction = false;
  }

  async function closeEventManagerForm() {
    console.log("Closing event manager form...");
    
    // Set flag to prevent reactive statement from re-opening
    isClosingForm = true;
    
    // Force close the form immediately
    showEventManagerForm = false;
    editingEventManager = null;
    editingEventIndex = null;
    editingEvent = null;
    showAddEventRule = false;
    showAddEventNotification = false;
    showAddEventAction = false;
    showEditEventRule = false;
    showEditEventNotification = false;
    showEditEventAction = false;
    editingRuleIndex = null;
    editingNotificationIndex = null;
    editingActionIndex = null;
    editingRule = null;
    editingNotification = null;
    editingAction = null;
    saveError = '';
    
    console.log("Form state cleared, showEventManagerForm:", showEventManagerForm);
    
    // Navigate to the same page without the edit parameter
    if (editEventManagerName) {
      console.log("Navigating to clean URL...");
      await goto($page.url.pathname, { replaceState: true });
      console.log("Navigation complete");
    }
    
    // Reset the flag after navigation
    isClosingForm = false;
  }

  async function saveEventManagerConfig() {
    if (!config.name.trim()) {
      saveError = "Event manager name is required";
      return;
    }

    saving = true;
    saveError = '';

    try {
      // Prepare the event manager config (exclude the name field)
      const eventManagerConfig: any = {
        events: config.events,
      };

      // Add mode if it exists
      if (config.mode) {
        eventManagerConfig.mode = config.mode;
      }

      // Add resources if they exist
      if (config.resources) {
        eventManagerConfig.resources = config.resources;
      }

      // Add back_state_to_disk and data_directory if they exist
      if (config.back_state_to_disk !== undefined) {
        eventManagerConfig.back_state_to_disk = config.back_state_to_disk;
      }
      if (config.data_directory) {
        eventManagerConfig.data_directory = config.data_directory;
      }

      // Add app_api_key and app_api_key_id if they exist
      if (config.app_api_key) {
        eventManagerConfig.app_api_key = config.app_api_key;
      }
      if (config.app_api_key_id) {
        eventManagerConfig.app_api_key_id = config.app_api_key_id;
      }

      // Add enable_backoff_schedule and backoff_schedule if they exist
      if (config.enable_backoff_schedule !== undefined) {
        eventManagerConfig.enable_backoff_schedule = config.enable_backoff_schedule;
      }
      if (config.backoff_schedule) {
        eventManagerConfig.backoff_schedule = config.backoff_schedule;
      }

      // Convert backoff schedule text to JSON if enabled
      if (config.enable_backoff_schedule && backoffScheduleText.trim()) {
        try {
          const parsedBackoff = JSON.parse(backoffScheduleText);
          eventManagerConfig.backoff_schedule = parsedBackoff;
        } catch (e) {
          saveError = "Invalid JSON in backoff schedule";
          saving = false;
          return;
        }
      }

      // If editing, use the original name to identify which event manager to update
      const originalName = editingEventManager ? editingEventManager.name : null;
      const targetName = config.name; // This is the new name (might be the same or different)
      
      if (editingEventManager && originalName !== targetName) {
        // We're renaming an event manager - we need to delete the old one and create a new one
        // For now, let's just create the new one and let the backend handle the old one
        console.log("Renaming event manager from", originalName, "to", targetName);
      }

      await saveEventManager(targetName, eventManagerConfig, originalName);
      
      // Refresh the event managers list
      const machineConfig = await getMachineConfig();
      if (machineConfig) {
        eventManagers = findEventManagers(machineConfig);
      }
      
      // Close the form and show success
      closeEventManagerForm();
    } catch (err: any) {
      console.error("Error saving event manager:", err);
      saveError = `Failed to save event manager: ${err.message}`;
    } finally {
      saving = false;
    }
  }

  function addRule() {
    if (newRule.type && editingEvent) {
      // Create a clean rule object with only relevant fields for the rule type
      const ruleToAdd: any = {
        type: newRule.type
      };

      // Add fields based on rule type
      if (['detection', 'classification', 'tracker'].includes(newRule.type)) {
        if (newRule.camera) ruleToAdd.camera = newRule.camera;
        if (newRule.class_regex) ruleToAdd.class_regex = newRule.class_regex;
        if (newRule.confidence_pct !== undefined) ruleToAdd.confidence_pct = newRule.confidence_pct;
        
        if (newRule.type === 'detection' && newRule.detector) {
          ruleToAdd.detector = newRule.detector;
        }
        if (newRule.type === 'classification' && newRule.classifier) {
          ruleToAdd.classifier = newRule.classifier;
        }
        if (newRule.type === 'tracker' && newRule.tracker) {
          ruleToAdd.tracker = newRule.tracker;
        }
        if (newRule.pause_on_known_secs !== undefined) {
          ruleToAdd.pause_on_known_secs = newRule.pause_on_known_secs;
        }
      } else if (newRule.type === 'time') {
        if (newRule.ranges && newRule.ranges.length > 0) {
          ruleToAdd.ranges = newRule.ranges;
        }
      } else if (newRule.type === 'call') {
        if (newRule.resource) ruleToAdd.resource = newRule.resource;
        if (newRule.method) ruleToAdd.method = newRule.method;
        if (newRule.payload) ruleToAdd.payload = newRule.payload;
        if (newRule.result_path) ruleToAdd.result_path = newRule.result_path;
        if (newRule.result_function) ruleToAdd.result_function = newRule.result_function;
        if (newRule.result_operator) ruleToAdd.result_operator = newRule.result_operator;
        if (newRule.result_value) ruleToAdd.result_value = newRule.result_value;
        if (newRule.inverse_pause_secs !== undefined) ruleToAdd.inverse_pause_secs = newRule.inverse_pause_secs;
      }

      editingEvent.rules = [...editingEvent.rules, ruleToAdd];
      newRule = { type: 'detection' };
      showAddEventRule = false;
    }
  }

  function addNotification() {
    if (newNotification.type && editingEvent) {
      const notificationToAdd: Notification = {
        type: newNotification.type,
        preset: newNotification.preset,
        include_image: newNotification.include_image,
        url: newNotification.url,
      };

      if (newNotification.to) {
        notificationToAdd.to = newNotification.to.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (newNotification.fcm_tokens) {
        notificationToAdd.fcm_tokens = newNotification.fcm_tokens.split(',').map(s => s.trim()).filter(Boolean);
      }

      editingEvent.notifications = [...editingEvent.notifications, notificationToAdd];
      newNotification = { type: 'sms' };
      showAddEventNotification = false;
    }
  }

  function addAction() {
    if (newAction.resource && newAction.method && newAction.payload !== undefined && editingEvent) {
      editingEvent.actions = [...editingEvent.actions, { ...newAction }];
      newAction = { resource: '', method: '', payload: '', when_secs: 0 };
      showAddEventAction = false;
    }
  }

  function removeRule(index: number) {
    config.events.forEach(event => {
      event.rules = event.rules.filter((_, i) => i !== index);
    });
  }

  function removeNotification(index: number) {
    config.events.forEach(event => {
      event.notifications = event.notifications.filter((_, i) => i !== index);
    });
  }

  function removeAction(index: number) {
    config.events.forEach(event => {
      event.actions = event.actions.filter((_, i) => i !== index);
    });
  }

  function getEditUrl(eventManagerName: string): string {
    if (typeof window === 'undefined') {
      return '#';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('edit', eventManagerName);
    return url.toString();
  }
</script>

{#if loading}
  <div class="loading">
    <h2>Loading machine configuration...</h2>
  </div>
{:else if error}
  <div class="error">
    <h2>Error</h2>
    <p>{error}</p>
  </div>
{:else if showEventManagerForm}
  <!-- Event Manager Configuration Form -->
  <div class="container">
    <div class="header">
      <h1>{editingEventManager ? 'Edit' : 'Create'} Event Manager</h1>
      <button class="btn btn-secondary" on:click={closeEventManagerForm}>Back to List</button>
    </div>
    
    {#if saveError}
      <div class="error-message">
        <p>{saveError}</p>
      </div>
    {/if}
    
    <div class="form-section">
      <h2>Basic Settings</h2>
      <div class="form-group">
        <label for="name">Event Manager Name:</label>
        <input id="name" type="text" bind:value={config.name} placeholder="Enter event manager name" />
      </div>
      
      <div class="form-group">
        <label for="mode">
          Mode:
          <span class="help-tooltip" title="The operating mode for the event manager">?</span>
        </label>
        <input id="mode" type="text" bind:value={config.mode} placeholder="e.g., active, inactive" />
      </div>
    </div>

    <div class="form-section">
      <div class="section-header" 
           on:click={() => showAdvancedSettings = !showAdvancedSettings}
           on:keydown={(e) => e.key === 'Enter' && (showAdvancedSettings = !showAdvancedSettings)}
           role="button"
           tabindex="0"
           aria-expanded={showAdvancedSettings}
           aria-controls="advanced-settings">
        <h2>Advanced Settings</h2>
        <span class="toggle-icon">{showAdvancedSettings ? '▼' : '▶'}</span>
      </div>
      
      {#if showAdvancedSettings}
        <div class="advanced-settings">
          <div class="form-group">
            <label for="app_api_key">
              App API Key:
              <span class="help-tooltip" title="Used to interface with Viam data management for triggered event management. Required if using do_command functionality.">?</span>
            </label>
            <input id="app_api_key" type="text" bind:value={config.app_api_key} placeholder="e.g., your_api_key" />
          </div>

          <div class="form-group">
            <label for="app_api_key_id">
              App API Key ID:
              <span class="help-tooltip" title="Used to interface with Viam data management for triggered event management. Required if using do_command functionality.">?</span>
            </label>
            <input id="app_api_key_id" type="text" bind:value={config.app_api_key_id} placeholder="e.g., your_api_key_id" />
          </div>

          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" bind:checked={config.back_state_to_disk} />
              Back State to Disk
              <span class="help-tooltip" title="When enabled, the event manager's state (e.g., backoff schedules, trigger counts) will be persisted to disk. This is useful for long-running services.">?</span>
            </label>
          </div>

          <div class="form-group">
            <label for="data_directory">
              Data Directory:
              <span class="help-tooltip" title="The directory where the event manager's state will be stored. This is only relevant if back_state_to_disk is true.">?</span>
            </label>
            <input id="data_directory" type="text" bind:value={config.data_directory} placeholder="e.g., /data/viam/event_manager" />
          </div>

          <div class="form-group">
            <label for="mode_override">
              Mode Override Mode:
              <span class="help-tooltip" title="The mode to override with (e.g., inactive)">?</span>
            </label>
            <input id="mode_override" type="text" bind:value={config.mode_override.mode} placeholder="e.g., inactive" />
          </div>

          <div class="form-group">
            <label for="mode_override_until">
              Mode Override Until:
              <span class="help-tooltip" title="ISO timestamp when the override should expire">?</span>
            </label>
            <input id="mode_override_until" type="datetime-local" bind:value={config.mode_override.until} />
          </div>

          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" bind:checked={config.enable_backoff_schedule} />
              Enable Backoff Schedule
              <span class="help-tooltip" title="When enabled, the event manager will use a backoff schedule to reduce the frequency of triggered events.">?</span>
            </label>
          </div>

          {#if config.enable_backoff_schedule}
            <div class="form-group">
              <label for="backoff_schedule">
                Backoff Schedule (JSON):
                <span class="help-tooltip" title="A JSON object defining the backoff schedule. Example: 300: 120 means after 5 minutes, pause for 2 minutes.">?</span>
              </label>
              <textarea id="backoff_schedule" bind:value={backoffScheduleText} placeholder="Enter JSON backoff schedule" rows="4"></textarea>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="form-section">
      <h2>Events</h2>
      {#if config.events.length > 0}
        {#each config.events as event, index}
          <div class="event-item">
            {#if editingEventIndex === index && editingEvent}
              <!-- Event Editing Form -->
              <div class="event-edit-form">
                <div class="edit-header">
                  <h3>Edit Event: {editingEvent.name}</h3>
                  <div class="edit-actions">
                    <button class="btn btn-success" on:click={saveEvent}>Save Event</button>
                    <button class="btn btn-secondary" on:click={closeEventEdit}>Cancel</button>
                  </div>
                </div>
                
                <div class="edit-sections">
                  <!-- Basic Settings -->
                  <div class="edit-section">
                    <h4>Basic Settings</h4>
                    <div class="form-row">
                      <div class="form-group">
                        <label for="event_name">Event Name:</label>
                        <input id="event_name" type="text" bind:value={editingEvent.name} />
                      </div>
                      <div class="form-group">
                        <label for="event_pause">Pause Alerting (seconds):</label>
                        <input id="event_pause" type="number" bind:value={editingEvent.pause_alerting_on_event_secs} min="0" />
                      </div>
                    </div>
                    
                    <div class="form-row">
                      <div class="form-group">
                        <label for="event_detection_hz">Detection Frequency (Hz):</label>
                        <input id="event_detection_hz" type="number" bind:value={editingEvent.detection_hz} min="1" max="60" />
                      </div>
                      <div class="form-group">
                        <label for="event_trigger_count">Trigger Sequence Count:</label>
                        <input id="event_trigger_count" type="number" bind:value={editingEvent.trigger_sequence_count} min="1" />
                      </div>
                    </div>
                    
                    <div class="form-row">
                      <div class="form-group">
                        <label for="event_logic_type">Rule Logic Type:</label>
                        <select id="event_logic_type" bind:value={editingEvent.rule_logic_type}>
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                          <option value="XOR">XOR</option>
                          <option value="NOR">NOR</option>
                          <option value="NAND">NAND</option>
                          <option value="XNOR">XNOR</option>
                        </select>
                      </div>
                      <div class="form-group">
                        <label for="event_modes">Modes (comma-separated):</label>
                        <input id="event_modes" type="text" bind:value={eventModesText} placeholder="active, inactive" />
                      </div>
                    </div>
                    
                    <div class="form-row">
                      <div class="form-group checkbox-group">
                        <label>
                          <input type="checkbox" bind:checked={editingEvent.require_rule_reset} />
                          Require Rule Reset
                        </label>
                      </div>
                      {#if editingEvent.require_rule_reset}
                        <div class="form-group">
                          <label for="event_reset_count">Rule Reset Count:</label>
                          <input id="event_reset_count" type="number" bind:value={editingEvent.rule_reset_count} min="1" />
                        </div>
                      {/if}
                    </div>
                    
                    <div class="form-row">
                      <div class="form-group checkbox-group">
                        <label>
                          <input type="checkbox" bind:checked={editingEvent.capture_video} />
                          Capture Video
                        </label>
                      </div>
                      {#if editingEvent.capture_video}
                        <div class="form-group">
                          <label for="event_video_resource">Video Capture Resource:</label>
                          <input id="event_video_resource" type="text" bind:value={editingEvent.video_capture_resource} placeholder="camera_name" />
                        </div>
                        <div class="form-group">
                          <label for="event_video_padding">Video Capture Padding (seconds):</label>
                          <input id="event_video_padding" type="number" bind:value={editingEvent.event_video_capture_padding_secs} min="0" />
                        </div>
                      {/if}
                    </div>
                  </div>

                  <!-- Rules Section -->
                  <div class="edit-section">
                    <div class="section-header">
                      <h4>Rules ({editingEvent.rules.length})</h4>
                      <button class="btn btn-primary btn-sm" on:click={() => showAddEventRule = true}>Add Rule</button>
                    </div>
                    
                    {#if editingEvent.rules.length > 0}
                      <div class="items-list">
                        {#each editingEvent.rules as rule, ruleIndex}
                          <div class="item-card">
                            <div class="item-header">
                              <h5>Rule {ruleIndex + 1}: {rule.type}</h5>
                              <div class="item-actions">
                                <button class="btn btn-secondary btn-sm" on:click={() => editEventRule(ruleIndex)}>Edit</button>
                                <button class="remove-btn" on:click={() => removeEventRule(ruleIndex)}>Remove</button>
                              </div>
                            </div>
                            <div class="item-details">
                              {#if rule.camera}<p>Camera: {rule.camera}</p>{/if}
                              {#if rule.detector}<p>Detector: {rule.detector}</p>{/if}
                              {#if rule.classifier}<p>Classifier: {rule.classifier}</p>{/if}
                              {#if rule.tracker}<p>Tracker: {rule.tracker}</p>{/if}
                              {#if rule.resource}<p>Resource: {rule.resource}</p>{/if}
                              {#if rule.method}<p>Method: {rule.method}</p>{/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="empty-message">No rules configured. Add a rule to get started.</p>
                    {/if}
                  </div>

                  <!-- Notifications Section -->
                  <div class="edit-section">
                    <div class="section-header">
                      <h4>Notifications ({editingEvent.notifications.length})</h4>
                      <button class="btn btn-primary btn-sm" on:click={() => showAddEventNotification = true}>Add Notification</button>
                    </div>
                    
                    {#if editingEvent.notifications.length > 0}
                      <div class="items-list">
                        {#each editingEvent.notifications as notification, notifIndex}
                          <div class="item-card">
                            <div class="item-header">
                              <h5>Notification {notifIndex + 1}: {notification.type}</h5>
                              <div class="item-actions">
                                <button class="btn btn-secondary btn-sm" on:click={() => editEventNotification(notifIndex)}>Edit</button>
                                <button class="remove-btn" on:click={() => removeEventNotification(notifIndex)}>Remove</button>
                              </div>
                            </div>
                            <div class="item-details">
                              {#if notification.to}<p>To: {notification.to.join(', ')}</p>{/if}
                              {#if notification.url}<p>URL: {notification.url}</p>{/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="empty-message">No notifications configured. Add a notification to get started.</p>
                    {/if}
                  </div>

                  <!-- Actions Section -->
                  <div class="edit-section">
                    <div class="section-header">
                      <h4>Actions ({editingEvent.actions.length})</h4>
                      <button class="btn btn-primary btn-sm" on:click={() => showAddEventAction = true}>Add Action</button>
                    </div>
                    
                    {#if editingEvent.actions.length > 0}
                      <div class="items-list">
                        {#each editingEvent.actions as action, actionIndex}
                          <div class="item-card">
                            <div class="item-header">
                              <h5>Action {actionIndex + 1}</h5>
                              <div class="item-actions">
                                <button class="btn btn-secondary btn-sm" on:click={() => editEventAction(actionIndex)}>Edit</button>
                                <button class="remove-btn" on:click={() => removeEventAction(actionIndex)}>Remove</button>
                              </div>
                            </div>
                            <div class="item-details">
                              <p>Resource: {action.resource}</p>
                              <p>Method: {action.method}</p>
                              <p>Payload: {action.payload}</p>
                              {#if action.when_secs !== 0}<p>Delay: {action.when_secs} seconds</p>{/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="empty-message">No actions configured. Add an action to get started.</p>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <!-- Event Display -->
              <div class="event-preview">
                <h3>Event {index + 1}: {event.name}</h3>
                <div class="event-counts">
                  <span class="count-item">Rules: {event.rules?.length || 0}</span>
                  <span class="count-item">Notifications: {event.notifications?.length || 0}</span>
                  <span class="count-item">Actions: {event.actions?.length || 0}</span>
                </div>
                <div class="event-actions">
                  <button class="btn btn-primary" on:click={() => editEvent(index)}>Edit Event</button>
                  <button class="btn btn-danger" on:click={() => removeEvent(index)}>Remove Event</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {:else}
        <div class="empty-events">
          <p>No events configured yet. Add your first event to get started.</p>
        </div>
      {/if}
      
      <div class="add-event-button">
        <button class="btn btn-primary" on:click={() => addEvent()}>Add New Event</button>
      </div>
    </div>

    <div class="form-section">
      <h2>Auto-Managed Resources</h2>
      <p class="help-text">Resources are automatically added based on what's referenced in your rules and actions.</p>
      
      {#if config.resources && Object.keys(config.resources).length > 0}
        <div class="resources-list">
          {#each Object.entries(config.resources) as [name, resource]}
            <div class="resource-item">
              <span class="resource-name">{name}</span>
              <span class="resource-type">{resource.type}:{resource.subtype}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-resources">No resources referenced yet. Add events or rules to see resources here.</p>
      {/if}
    </div>

    <div class="form-section">
      <button class="btn btn-success" on:click={saveEventManagerConfig} disabled={saving}>
        {saving ? 'Saving...' : 'Save Event Manager'}
      </button>
    </div>
  </div>
{:else}
  <!-- Event Manager List -->
  <div class="container">
    <div class="header">
      <h1>Event Manager Configuration</h1>
      <button class="btn btn-primary" on:click={() => openEventManagerForm()}>Create New Event Manager</button>
    </div>

    {#if eventManagers.length === 0}
      <div class="empty-state">
        <h2>No Event Managers Found</h2>
        <p>No event manager configurations were found in the machine config.</p>
        <button class="btn btn-primary" on:click={() => openEventManagerForm()}>Create Your First Event Manager</button>
      </div>
    {:else}
      <div class="event-managers-list">
        <h2>Existing Event Managers</h2>
        {#each eventManagers as eventManager}
          <div class="event-manager-item">
            <div class="event-manager-info">
              <h3>{eventManager.name}</h3>
              <p>Events: {eventManager.config?.events?.length || 0}</p>
            </div>
            <div class="event-manager-actions">
              <a href={typeof window !== 'undefined' ? getEditUrl(eventManager.name) : '#'} class="btn btn-primary">Edit</a>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if} 

<!-- Add Forms -->
{#if showAddEventRule}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Add New Rule</h5>
      <div class="form-group">
        <label for="rule_type">Rule Type:</label>
        <select id="rule_type" bind:value={newRule.type}>
          <option value="detection">Detection</option>
          <option value="classification">Classification</option>
          <option value="tracker">Tracker</option>
          <option value="time">Time</option>
          <option value="call">Call</option>
        </select>
      </div>
      
      {#if ['detection', 'classification', 'tracker'].includes(newRule.type)}
        <div class="form-group">
          <label for="camera">Camera:</label>
          <select id="camera" bind:value={newRule.camera}>
            <option value="">Select a camera</option>
            {#each cameras as cameraName}
              <option value={cameraName}>{cameraName}</option>
            {/each}
          </select>
        </div>
        
        {#if newRule.type === 'detection'}
          <div class="form-group">
            <label for="detector">Detector:</label>
            <select id="detector" bind:value={newRule.detector}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        {#if newRule.type === 'classification'}
          <div class="form-group">
            <label for="classifier">Classifier:</label>
             <select id="classifier" bind:value={newRule.classifier}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        {#if newRule.type === 'tracker'}
          <div class="form-group">
            <label for="tracker">Tracker:</label>
            <select id="tracker" bind:value={newRule.tracker}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        <div class="form-group">
          <label for="class_regex">Class Regex:</label>
          <input id="class_regex" type="text" bind:value={newRule.class_regex} placeholder=".*" />
        </div>
        
        <div class="form-group">
          <label for="confidence_pct">Confidence %:</label>
          <input id="confidence_pct" type="number" bind:value={newRule.confidence_pct} min="0" max="1" step="0.1" />
        </div>
      {/if}
      
      {#if newRule.type === 'call'}
        <div class="form-group">
          <label for="resource">Resource:</label>
          <select id="resource" bind:value={newRule.resource}>
            <option value="">Select a resource</option>
            {#each allResources as resourceName}
              <option value={resourceName}>{resourceName}</option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label for="method">Method:</label>
          <select id="method" bind:value={newRule.method} disabled={!newRule.resource}>
            <option value="">Select a method</option>
            {#each callRuleMethods as methodName}
              <option value={methodName}>{methodName}</option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label for="payload">Payload (JSON):</label>
          <input id="payload" type="text" bind:value={newRule.payload} placeholder="JSON object, e.g. 'key': 'value'" />
        </div>
      {/if}
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={addRule}>Add Rule</button>
        <button class="btn btn-secondary" on:click={() => showAddEventRule = false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showAddEventNotification}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Add New Notification</h5>
      <div class="form-group">
        <label for="notification_type">Type:</label>
        <select id="notification_type" bind:value={newNotification.type}>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
          <option value="webhook_get">Webhook GET</option>
          <option value="push">Push</option>
        </select>
      </div>
      
      {#if newNotification.type === 'sms' || newNotification.type === 'email'}
        <div class="form-group">
          <label for="preset">Preset:</label>
          <input id="preset" type="text" bind:value={newNotification.preset} placeholder="e.g., twilio_sms" />
        </div>

        <div class="form-group">
          <label for="to">To (comma-separated):</label>
          <input id="to" type="text" bind:value={newNotification.to} placeholder="phone@example.com, +1234567890" />
        </div>
      {/if}
      
      {#if newNotification.type === 'webhook_get'}
        <div class="form-group">
          <label for="url">URL:</label>
          <input id="url" type="url" bind:value={newNotification.url} placeholder="https://example.com/webhook" />
        </div>
      {/if}
      
      {#if newNotification.type === 'push'}
        <div class="form-group">
          <label for="fcm_tokens">FCM Tokens (comma-separated):</label>
          <input id="fcm_tokens" type="text" bind:value={newNotification.fcm_tokens} placeholder="token1, token2" />
        </div>
      {/if}
      
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={newNotification.include_image} />
          Include Image
        </label>
      </div>
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={addNotification}>Add Notification</button>
        <button class="btn btn-secondary" on:click={() => showAddEventNotification = false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showAddEventAction}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Add New Action</h5>
      <div class="form-group">
        <label for="action_resource">Resource:</label>
        <select id="action_resource" bind:value={newAction.resource}>
          <option value="">Select a resource</option>
          {#each allResources as resourceName}
            <option value={resourceName}>{resourceName}</option>
          {/each}
        </select>
      </div>
      
      <div class="form-group">
        <label for="action_method">Method:</label>
        <select id="action_method" bind:value={newAction.method} disabled={!newAction.resource}>
          <option value="">Select a method</option>
          {#each actionMethods as methodName}
            <option value={methodName}>{methodName}</option>
          {/each}
        </select>
      </div>
      
      <div class="form-group">
        <label for="action_payload">Payload (JSON):</label>
        <input id="action_payload" type="text" bind:value={newAction.payload} placeholder="JSON object, e.g. 'key': 'value'" />
      </div>
      
      <div class="form-group">
        <label for="when_secs">Delay (seconds):</label>
        <input id="when_secs" type="number" bind:value={newAction.when_secs} min="-1" />
      </div>
      
      <div class="form-group">
        <label for="response_match">Response Match (regex):</label>
        <input id="response_match" type="text" bind:value={newAction.response_match} placeholder="optional" />
      </div>
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={addAction}>Add Action</button>
        <button class="btn btn-secondary" on:click={() => showAddEventAction = false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit Forms -->
{#if showEditEventRule && editingRule}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Edit Rule</h5>
      <div class="form-group">
        <label for="edit_rule_type">Rule Type:</label>
        <select id="edit_rule_type" bind:value={editingRule.type}>
          <option value="detection">Detection</option>
          <option value="classification">Classification</option>
          <option value="tracker">Tracker</option>
          <option value="time">Time</option>
          <option value="call">Call</option>
        </select>
      </div>
      
      {#if ['detection', 'classification', 'tracker'].includes(editingRule.type)}
        <div class="form-group">
          <label for="edit_camera">Camera:</label>
          <select id="edit_camera" bind:value={editingRule.camera}>
            <option value="">Select a camera</option>
            {#each cameras as cameraName}
              <option value={cameraName}>{cameraName}</option>
            {/each}
          </select>
        </div>
        
        {#if editingRule.type === 'detection'}
          <div class="form-group">
            <label for="edit_detector">Detector:</label>
            <select id="edit_detector" bind:value={editingRule.detector}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        {#if editingRule.type === 'classification'}
          <div class="form-group">
            <label for="edit_classifier">Classifier:</label>
             <select id="edit_classifier" bind:value={editingRule.classifier}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        {#if editingRule.type === 'tracker'}
          <div class="form-group">
            <label for="edit_tracker">Tracker:</label>
            <select id="edit_tracker" bind:value={editingRule.tracker}>
              <option value="">Select a vision service</option>
              {#each visionServices as serviceName}
                <option value={serviceName}>{serviceName}</option>
              {/each}
            </select>
          </div>
        {/if}
        
        <div class="form-group">
          <label for="edit_class_regex">Class Regex:</label>
          <input id="edit_class_regex" type="text" bind:value={editingRule.class_regex} placeholder=".*" />
        </div>
        
        <div class="form-group">
          <label for="edit_confidence_pct">Confidence %:</label>
          <input id="edit_confidence_pct" type="number" bind:value={editingRule.confidence_pct} min="0" max="1" step="0.1" />
        </div>
      {/if}
      
      {#if editingRule.type === 'call'}
        <div class="form-group">
          <label for="edit_resource">Resource:</label>
          <select id="edit_resource" bind:value={editingRule.resource}>
            <option value="">Select a resource</option>
            {#each allResources as resourceName}
              <option value={resourceName}>{resourceName}</option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label for="edit_method">Method:</label>
          <select id="edit_method" bind:value={editingRule.method} disabled={!editingRule.resource}>
            <option value="">Select a method</option>
            {#each callRuleMethods as methodName}
              <option value={methodName}>{methodName}</option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label for="edit_payload">Payload (JSON):</label>
          <input id="edit_payload" type="text" bind:value={editingRule.payload} placeholder="JSON object, e.g. 'key': 'value'" />
        </div>
      {/if}
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={saveEventRule}>Save Rule</button>
        <button class="btn btn-secondary" on:click={closeEventRuleEdit}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showEditEventNotification && editingNotification}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Edit Notification</h5>
      <div class="form-group">
        <label for="edit_notification_type">Type:</label>
        <select id="edit_notification_type" bind:value={editingNotification.type}>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
          <option value="webhook_get">Webhook GET</option>
          <option value="push">Push</option>
        </select>
      </div>
      
      {#if editingNotification.type === 'sms' || editingNotification.type === 'email'}
        <div class="form-group">
          <label for="edit_preset">Preset:</label>
          <input id="edit_preset" type="text" bind:value={editingNotification.preset} placeholder="e.g., twilio_sms" />
        </div>

        <div class="form-group">
          <label for="edit_to">To (comma-separated):</label>
          <input id="edit_to" type="text" value={editingNotification?.to?.join(', ') || ''} on:input={(e) => {
            if (editingNotification && e.target instanceof HTMLInputElement) {
              editingNotification.to = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
          }} placeholder="phone@example.com, +1234567890" />
        </div>
      {/if}
      
      {#if editingNotification.type === 'webhook_get'}
        <div class="form-group">
          <label for="edit_url">URL:</label>
          <input id="edit_url" type="url" bind:value={editingNotification.url} placeholder="https://example.com/webhook" />
        </div>
      {/if}
      
      {#if editingNotification.type === 'push'}
        <div class="form-group">
          <label for="edit_fcm_tokens">FCM Tokens (comma-separated):</label>
          <input id="edit_fcm_tokens" type="text" value={editingNotification?.fcm_tokens?.join(', ') || ''} on:input={(e) => {
            if (editingNotification && e.target instanceof HTMLInputElement) {
              editingNotification.fcm_tokens = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
          }} placeholder="token1, token2" />
        </div>
      {/if}
      
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={editingNotification.include_image} />
          Include Image
        </label>
      </div>
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={saveEventNotification}>Save Notification</button>
        <button class="btn btn-secondary" on:click={closeEventNotificationEdit}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showEditEventAction && editingAction}
  <div class="add-form-overlay">
    <div class="add-form">
      <h5>Edit Action</h5>
      <div class="form-group">
        <label for="edit_action_resource">Resource:</label>
        <select id="edit_action_resource" bind:value={editingAction.resource}>
          <option value="">Select a resource</option>
          {#each allResources as resourceName}
            <option value={resourceName}>{resourceName}</option>
          {/each}
        </select>
      </div>
      
      <div class="form-group">
        <label for="edit_action_method">Method:</label>
        <select id="edit_action_method" bind:value={editingAction.method} disabled={!editingAction.resource}>
          <option value="">Select a method</option>
          {#each actionMethods as methodName}
            <option value={methodName}>{methodName}</option>
          {/each}
        </select>
      </div>
      
      <div class="form-group">
        <label for="edit_action_payload">Payload (JSON):</label>
        <input id="edit_action_payload" type="text" bind:value={editingAction.payload} placeholder="JSON object, e.g. 'key': 'value'" />
      </div>
      
      <div class="form-group">
        <label for="edit_when_secs">Delay (seconds):</label>
        <input id="edit_when_secs" type="number" bind:value={editingAction.when_secs} min="-1" />
      </div>
      
      <div class="form-group">
        <label for="edit_response_match">Response Match (regex):</label>
        <input id="edit_response_match" type="text" bind:value={editingAction.response_match} placeholder="optional" />
      </div>
      
      <div class="button-group">
        <button class="btn btn-primary" on:click={saveEventAction}>Save Action</button>
        <button class="btn btn-secondary" on:click={closeEventActionEdit}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }

  .loading, .error {
    text-align: center;
    padding: 40px;
  }

  .error-message {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 20px;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    background: #f8f9fa;
    border-radius: 8px;
    margin: 20px 0;
  }

  .event-managers-list {
    margin-top: 20px;
  }

  .event-manager-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 20px;
    margin-bottom: 15px;
  }

  .event-manager-info h3 {
    margin: 0 0 10px 0;
    color: #495057;
  }

  .event-manager-info p {
    margin: 5px 0;
    color: #6c757d;
    font-size: 14px;
  }

  .event-manager-actions {
    display: flex;
    gap: 10px;
  }

  h1 {
    color: #333;
    margin-bottom: 0;
  }

  .form-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid #e9ecef;
  }

  .form-section h2 {
    color: #495057;
    margin-top: 0;
    border-bottom: 2px solid #007bff;
    padding-bottom: 10px;
  }

  .form-group {
    margin-bottom: 15px;
  }

  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: #495057;
    position: relative;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #007bff;
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }

  /* Checkbox alignment */
  .checkbox-group {
    display: flex;
    align-items: flex-start;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin: 0;
  }

  .checkbox-group input[type="checkbox"] {
    width: auto;
    margin: 0;
    flex-shrink: 0;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #007bff;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0056b3;
  }

  .btn-secondary {
    background: #6c757d;
    color: white;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #545b62;
  }

  .btn-success {
    background: #28a745;
    color: white;
    font-size: 16px;
    padding: 12px 24px;
  }

  .btn-success:hover:not(:disabled) {
    background: #1e7e34;
  }

  .btn-danger {
    background: #dc3545;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #c82333;
  }

  .remove-btn {
    background: #dc3545;
    color: white;
    padding: 5px 10px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .remove-btn:hover {
    background: #c82333;
  }

  .button-group {
    display: flex;
    gap: 10px;
    margin-top: 15px;
  }

  .add-form {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 20px;
    margin-top: 15px;
  }

  .help-text {
    color: #6c757d;
    font-size: 12px;
    margin-top: 5px;
  }

  /* Tooltip Styles */
  .help-tooltip {
    margin-left: 5px;
    color: #007bff;
    cursor: pointer;
    text-decoration: none;
    position: relative;
    display: inline-block;
    width: 14px;
    height: 14px;
    line-height: 14px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    font-size: 10px;
    text-align: center;
    vertical-align: middle;
    transition: background-color 0.2s ease;
    user-select: none;
    /* Try to reduce tooltip delay */
    -webkit-tooltip-delay: 0s;
    tooltip-delay: 0s;
  }

  .help-tooltip:hover {
    text-decoration: none;
    background-color: #0056b3;
  }

  .help-tooltip::after {
    content: "?";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: bold;
  }

  /* Make tooltips appear instantly */
  [title] {
    transition-delay: 0s !important;
    --tooltip-delay: 0s;
  }

  /* New styles for resource display */
  .resources-list {
    margin-top: 15px;
    padding-top: 15px;
    border-top: 1px solid #e9ecef;
  }

  .resource-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f1f3f5;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 8px;
    font-size: 14px;
    color: #343a40;
  }

  .resource-name {
    font-weight: 500;
    color: #007bff;
  }

  .resource-type {
    font-size: 12px;
    color: #6c757d;
  }

  /* Collapsible section styles */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding-bottom: 10px;
    border-bottom: 1px solid #e9ecef;
    margin-bottom: 15px;
    transition: background-color 0.2s ease;
  }

  .section-header:hover {
    background-color: #f8f9fa;
    border-radius: 4px;
  }

  .section-header h2 {
    margin-bottom: 0;
    color: #495057;
    font-size: 18px;
  }

  .toggle-icon {
    font-size: 16px;
    color: #6c757d;
    transition: transform 0.3s ease;
    user-select: none;
  }

  .advanced-settings {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 15px;
    margin-top: 15px;
  }

  .advanced-settings .form-group {
    margin-bottom: 10px;
  }

  .event-item {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 15px;
    margin-bottom: 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .event-item h3 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
  }

  .event-actions {
    display: flex;
    gap: 10px;
  }

  .add-event-button {
    margin-top: 15px;
  }

  .event-edit-form {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 15px;
    margin-top: 15px;
  }

  .event-edit-form h3 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
    margin-bottom: 15px;
  }

  .event-edit-form .form-group {
    margin-bottom: 10px;
  }

  /* New styles for event edit form layout */
  .edit-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  .edit-header h3 {
    margin: 0;
    color: #495057;
    font-size: 18px;
  }

  .edit-actions {
    display: flex;
    gap: 10px;
  }

  .edit-sections {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .edit-section {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 15px;
  }

  .edit-section h4 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
    margin-bottom: 10px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding-bottom: 10px;
    border-bottom: 1px solid #e9ecef;
    margin-bottom: 10px;
  }

  .section-header h4 {
    margin: 0;
    color: #495057;
    font-size: 16px;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .item-card {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 15px;
  }

  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .item-header h5 {
    margin: 0;
    color: #495057;
    font-size: 14px;
  }

  .item-actions {
    display: flex;
    gap: 5px;
  }

  .item-details p {
    margin: 5px 0;
    color: #6c757d;
    font-size: 13px;
  }

  .empty-message {
    color: #6c757d;
    font-style: italic;
    padding: 10px;
  }

  .form-row {
    display: flex;
    gap: 15px;
    margin-bottom: 10px;
  }

  .form-row .form-group {
    flex: 1;
  }

  .add-form-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .add-form-overlay .add-form {
    background: white;
    border-radius: 8px;
    padding: 20px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  .btn-sm {
    padding: 5px 10px;
    font-size: 12px;
  }

  .empty-events {
    text-align: center;
    padding: 40px 20px;
    background: #f8f9fa;
    border: 2px dashed #dee2e6;
    border-radius: 8px;
    margin: 20px 0;
  }

  .empty-events p {
    color: #6c757d;
    font-size: 16px;
    margin: 0;
  }

  /* New styles for event preview */
  .event-preview {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 15px;
    margin-bottom: 15px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .event-preview h3 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
    margin-bottom: 10px;
  }

  .event-counts {
    display: flex;
    gap: 15px;
    margin-bottom: 10px;
    font-size: 14px;
    color: #6c757d;
  }

  .count-item {
    font-weight: 500;
    color: #343a40;
  }
</style> 