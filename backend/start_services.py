import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def main():
    directory = Path(__file__).resolve().parent
    worker_command = [sys.executable, 'manage.py', 'evaluate_alerts', '--loop', '--interval', '60']
    web_command = [sys.executable, '-m', 'gunicorn', 'config.wsgi:application',
                   '--bind', f"0.0.0.0:{os.environ.get('PORT', '8000')}", '--timeout', '180',
                   '--access-logfile', '-', '--error-logfile', '-']
    children = []
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        web = subprocess.Popen(web_command, cwd=directory)
        children.append(web)
        worker = subprocess.Popen(worker_command, cwd=directory)
        children.append(worker)
        while not stopping and web.poll() is None:
            if worker.poll() is not None:
                print('Alert worker exited; restarting in 5 seconds.', flush=True)
                time.sleep(5)
                if stopping or web.poll() is not None:
                    break
                worker = subprocess.Popen(worker_command, cwd=directory)
                children.append(worker)
            time.sleep(1)
        return web.returncode or 0
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    sys.exit(main())
