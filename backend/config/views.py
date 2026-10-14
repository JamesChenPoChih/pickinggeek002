from django.db import connection
from django.http import FileResponse, Http404, JsonResponse
from django.conf import settings


def pwa_asset(request, name):
    files = {
        "sw.js": ("sw.js", "application/javascript"),
        "manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
        "offline.html": ("offline.html", "text/html"),
        **{icon: (f"pwa-icons/{icon}", "image/png") for icon in
           ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]},
    }
    if name not in files:
        raise Http404
    filename, content_type = files[name]
    path = settings.FRONTEND_DIST_DIR / "frontend" / filename
    if not path.is_file():
        raise Http404
    response = FileResponse(path.open("rb"), content_type=content_type)
    response["Cache-Control"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    if name == "sw.js":
        response["Service-Worker-Allowed"] = "/"
    return response


def service_status(request):
    return JsonResponse({
        "service": "Picking Geek API",
        "status": "ok",
        "api": "/api/",
        "health": "/health/",
    })


def health_check(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        return JsonResponse({"status": "unhealthy", "database": "unavailable"}, status=503)

    return JsonResponse({"status": "healthy", "database": "connected"})
