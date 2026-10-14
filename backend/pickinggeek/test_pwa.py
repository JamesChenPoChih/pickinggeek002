from django.test import SimpleTestCase


class PwaTests(SimpleTestCase):
    def test_manifest_is_public_and_standalone(self):
        response = self.client.get('/manifest.webmanifest')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/manifest+json')
        import json
        manifest = json.loads(b''.join(response.streaming_content))
        self.assertEqual(manifest['display'], 'standalone')
        self.assertEqual(manifest['scope'], '/')
        self.assertEqual(manifest['start_url'], '/')
        self.assertEqual({icon['sizes'] for icon in manifest['icons']}, {'192x192', '512x512'})

    def test_worker_headers_and_offline_page(self):
        response = self.client.get('/sw.js')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/javascript')
        self.assertEqual(response['Service-Worker-Allowed'], '/')
        self.assertEqual(response['Cache-Control'], 'no-cache')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(self.client.get('/offline.html').status_code, 200)

    def test_icons_are_png_and_unknown_file_is_not_served(self):
        for icon in ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']:
            response = self.client.get('/pwa-icons/' + icon)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'image/png')
            self.assertTrue(b''.join(response.streaming_content).startswith(b'\x89PNG'))
        self.assertEqual(self.client.get('/pwa-icons/settings.py').status_code, 404)
