#!/usr/bin/python
import sys
sys.path.insert(0,"/var/www/html/projects/FlaskApp/PythonBahamas")

from app import app as application
application.secret_key = 'asdf'
