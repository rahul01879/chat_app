import requests

response = requests.delete('http://localhost:8000/admin/cleanup')
print(response.json())
