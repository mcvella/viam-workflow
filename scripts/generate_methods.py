import inspect
import json
from viam.components.arm import Arm
from viam.components.base import Base
from viam.components.board import Board
from viam.components.camera import Camera
from viam.components.gantry import Gantry
from viam.components.gripper import Gripper
from viam.components.motor import Motor
from viam.components.sensor import Sensor
from viam.components.servo import Servo
from viam.services.vision import VisionClient
from viam.services.slam import SLAMClient
from viam.services.motion import MotionClient

# A mapping of resource APIs to their Python SDK classes
RESOURCE_CLASSES = {
    'rdk:component:arm': Arm,
    'rdk:component:base': Base,
    'rdk:component:board': Board,
    'rdk:component:camera': Camera,
    'rdk:component:gantry': Gantry,
    'rdk:component:gripper': Gripper,
    'rdk:component:motor': Motor,
    'rdk:component:sensor': Sensor,
    'rdk:component:servo': Servo,
    'rdk:service:vision': VisionClient,
    'rdk:service:slam': SLAMClient,
    'rdk:service:motion': MotionClient,
}

def get_public_methods(cls):
    """Gets the public methods of a class, excluding inherited and private methods."""
    # Exclude methods from the base Component/Service classes to keep the list clean.
    exclude = ['__init__', 'close', 'get_operation']
    methods = []
    for name, func in inspect.getmembers(cls, inspect.isfunction):
        if not name.startswith('_') and name not in exclude:
            methods.append(name)
    # Always include 'do_command' if it's not already present
    if 'do_command' not in methods:
        methods.append('do_command')
    return sorted(methods)

def generate_methods_json():
    """Generates a JSON file of resource methods from the Python SDK."""
    resource_methods = {}
    for api, cls in RESOURCE_CLASSES.items():
        resource_methods[api] = get_public_methods(cls)

    with open('src/lib/resource_methods.json', 'w') as f:
        json.dump(resource_methods, f, indent=2)

if __name__ == '__main__':
    generate_methods_json()
    print("Successfully generated src/lib/resource_methods.json") 