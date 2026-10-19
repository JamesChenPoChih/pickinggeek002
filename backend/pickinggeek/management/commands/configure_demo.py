import getpass
import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from pickinggeek.models import BillingAccount, DemoAccount, User


class Command(BaseCommand):
    help = 'Provision a designated non-admin demo account without resetting existing daily usage.'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='Demo')

    def handle(self, *args, **options):
        username = options['username'].strip()
        if not username or len(username) > 150:
            raise CommandError('Invalid demo username.')
        password = os.environ.get('DEMO_ACCOUNT_PASSWORD') or getpass.getpass('Demo password: ')
        if len(password) < 10:
            raise CommandError('Use a password with at least ten characters.')
        with transaction.atomic():
            users = list(User.objects.select_for_update().filter(username__iexact=username))
            if len(users) > 1:
                raise CommandError('Multiple case-insensitive demo accounts exist; review them first.')
            user = users[0] if users else User(username=username)
            if user.is_staff or user.is_superuser or user.google_subject:
                raise CommandError('Refusing to replace an administrator or Google-linked account.')
            if user.pk and BillingAccount.objects.filter(user=user).exclude(customer_id__isnull=True).exclude(customer_id='').exists():
                raise CommandError('Refusing to replace a Stripe-linked account.')
            user.username = username
            user.tier = User.Tier.PRO
            user.is_active = True
            user.is_staff = user.is_superuser = False
            user.set_password(password)
            user.save()
            user.groups.clear()
            user.user_permissions.clear()
            DemoAccount.objects.get_or_create(user=user)
        self.stdout.write(self.style.SUCCESS(f'{username} configured: no admin privileges; Pro 20/day, Ultra 3/day.'))
