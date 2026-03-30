import asyncio
import os
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton,
)
from supabase import create_client

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
PWA_URL = os.getenv("PWA_URL", "")
ADMIN_TELEGRAM = os.getenv("ADMIN_TELEGRAM", "")
ADMIN_PHONE = os.getenv("ADMIN_PHONE", "")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def asosiy_menyu():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🔥 Kun chegirmalari")],
            [KeyboardButton(text="🏪 Kafelar ro'yxati")],
            [KeyboardButton(text="📞 Aloqa")],
        ],
        resize_keyboard=True
    )


# === /start ===
@dp.message(CommandStart())
async def start(message: types.Message):
    try:
        supabase.table("mijozlar").upsert({
            "telegram_id": message.from_user.id,
            "ism": message.from_user.full_name,
        }, on_conflict="telegram_id").execute()
    except Exception as e:
        print(f"Baza xatosi: {e}")
    await message.answer(
        f"Assalomu alaykum, {message.from_user.first_name}! 👋\n\n"
        f"🍽 <b>Taomzor</b> ga xush kelibsiz!\n\n"
        f"Quyidagi bo'limlardan birini tanlang:",
        parse_mode="HTML",
        reply_markup=asosiy_menyu()
    )


# === /buyurtmalar ===
@dp.message(Command("buyurtmalar"))
async def buyurtmalar(message: types.Message):
    telegram_id = message.from_user.id
    try:
        admin_res = supabase.table("adminlar")\
            .select("*, kafelar(id, nomi)")\
            .eq("telegram_id", telegram_id)\
            .execute()

        if not admin_res.data:
            await message.answer(
                "❌ Siz admin sifatida ro'yxatdan o'tmagansiz.\n"
                "Iltimos, super admin bilan bog'laning."
            )
            return

        admin = admin_res.data[0]
        kafe = admin.get("kafelar") or {}
        kafe_id = kafe.get("id")
        kafe_nomi = kafe.get("nomi", "—")

        res = supabase.table("buyurtmalar")\
            .select("*, mijozlar(ism, telefon), buyurtma_tafsilot(soni, narx, menyular(nomi))")\
            .eq("kafe_id", kafe_id)\
            .in_("holat", ["yangi", "qabul"])\
            .order("yaratilgan", desc=True)\
            .limit(10)\
            .execute()

        if not res.data:
            await message.answer(
                f"🏪 <b>{kafe_nomi}</b>\n\n📋 Hozircha yangi buyurtmalar yo'q.",
                parse_mode="HTML"
            )
            return

        for b in res.data:
            mijoz = b.get("mijozlar") or {}
            taomlar = b.get("buyurtma_tafsilot") or []
            taom_text = "\n".join([
                f"  • {t.get('menyular', {}).get('nomi', '?')} ×{t.get('soni', 1)}"
                for t in taomlar
            ])
            text = (
                f"🔔 <b>Yangi buyurtma!</b>\n\n"
                f"🆔 #{b['id'][:6]}\n"
                f"👤 {mijoz.get('ism', '—')} | 📞 {mijoz.get('telefon', '—')}\n"
                f"🍽 Taomlar:\n{taom_text}\n"
                f"💰 Jami: {int(b.get('jami_narx', 0)):,} so'm\n"
                f"📍 {b.get('manzil', '—')}\n"
                f"📌 Holat: {b.get('holat', '—')}"
            )
            holat = b.get('holat')
            bid = b['id']
            if holat == 'yangi':
                tugma = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="✅ Qabul qilish", callback_data=f"qabul_{bid}")]
                ])
            else:
                tugma = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🛵 Yetkazildi", callback_data=f"yetkazildi_{bid}")]
                ])
            await message.answer(text, parse_mode="HTML", reply_markup=tugma)

    except Exception as e:
        await message.answer("Xatolik yuz berdi.")
        print(f"Xato: {e}")


# === /logout ===
@dp.message(Command("logout"))
async def logout(message: types.Message):
    await message.answer("👋 Chiqildi!", reply_markup=asosiy_menyu())


# === KUN CHEGIRMALARI ===
@dp.message(F.text == "🔥 Kun chegirmalari")
async def kun_chegirmalari(message: types.Message):
    try:
        res = supabase.table("chegirmalar")\
            .select("*, menyular(nomi), kafelar(nomi)")\
            .eq("faol", True)\
            .execute()
        if not res.data:
            await message.answer("😔 Hozircha aktiv chegirmalar yo'q.")
            return
        text = "🔥 <b>Bugungi chegirmalar:</b>\n\n"
        for item in res.data:
            taom = item.get("menyular") or {}
            kafe = item.get("kafelar") or {}
            text += (
                f"🍴 <b>{taom.get('nomi', '—')}</b>\n"
                f"🏪 {kafe.get('nomi', '—')}\n"
                f"💰 <s>{item['asl_narx']:,.0f}</s> → "
                f"<b>{item['chegirma_narx']:,.0f} so'm</b>\n\n"
            )
        await message.answer(text, parse_mode="HTML")
    except Exception as e:
        await message.answer("Xatolik yuz berdi.")
        print(f"Xato: {e}")


# === KAFELAR RO'YXATI ===
@dp.message(F.text == "🏪 Kafelar ro'yxati")
async def kafelar_royxati(message: types.Message):
    try:
        res = supabase.table("kafelar")\
            .select("nomi, telefon, manzil, latitude, longitude")\
            .eq("faol", True)\
            .execute()
        if not res.data:
            await message.answer("😔 Hozircha kafelar yo'q.")
            return
        for kafe in res.data:
            text = (
                f"🏪 <b>{kafe.get('nomi', '—')}</b>\n"
                f"📍 {kafe.get('manzil', '—')}\n"
                f"📞 {kafe.get('telefon', '—')}"
            )
            await message.answer(text, parse_mode="HTML")
            lat = kafe.get("latitude")
            lon = kafe.get("longitude")
            if lat and lon:
                await bot.send_location(message.chat.id, latitude=float(lat), longitude=float(lon))
    except Exception as e:
        await message.answer("Xatolik yuz berdi.")
        print(f"Xato: {e}")


# === ALOQA ===
@dp.message(F.text == "📞 Aloqa")
async def aloqa(message: types.Message):
    admin_user = f"@{ADMIN_TELEGRAM}" if ADMIN_TELEGRAM else ""
    admin_phone = ADMIN_PHONE or "—"
    await message.answer(
        f"📞 <b>Aloqa:</b>\n\nAdmin: {admin_user}\nTelefon: {admin_phone}",
        parse_mode="HTML"
    )


# === QABUL QILISH ===
@dp.callback_query(F.data.startswith("qabul_"))
async def buyurtma_qabul(callback: types.CallbackQuery):
    buyurtma_id = callback.data.replace("qabul_", "")
    try:
        supabase.table("buyurtmalar")\
            .update({"holat": "qabul"})\
            .eq("id", buyurtma_id)\
            .execute()
        await callback.answer("✅ Qabul qilindi!")
        tugma = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="🛵 Yetkazildi",
                callback_data=f"yetkazildi_{buyurtma_id}"
            )]
        ])
        await callback.message.edit_reply_markup(reply_markup=tugma)
    except Exception as e:
        await callback.answer("Xatolik!")
        print(f"Xato: {e}")


# === YETKAZILDI ===
@dp.callback_query(F.data.startswith("yetkazildi_"))
async def buyurtma_yetkazildi(callback: types.CallbackQuery):
    buyurtma_id = callback.data.replace("yetkazildi_", "")
    try:
        supabase.table("buyurtmalar")\
            .update({"holat": "yetkazildi"})\
            .eq("id", buyurtma_id)\
            .execute()
        await callback.answer("🛵 Yetkazildi!")
        await callback.message.delete()
    except Exception as e:
        await callback.answer("Xatolik!")
        print(f"Xato: {e}")


# === MATN HANDLER ===
@dp.message(F.text)
async def matn_handler(message: types.Message):
    await message.answer("Tugmalardan birini tanlang:", reply_markup=asosiy_menyu())


# === ISHGA TUSHIRISH ===
# === AVTOMATIK TEKSHIRISH ===
yuborilgan_buyurtmalar = set()

async def yangi_buyurtmalarni_tekshir():
    while True:
        try:
            adminlar = supabase.table("adminlar")\
                .select("telegram_id, kafelar(id, nomi)")\
                .execute()

            for admin in (adminlar.data or []):
                tg_id = admin.get("telegram_id")
                kafe = admin.get("kafelar") or {}
                kafe_id = kafe.get("id")
                kafe_nomi = kafe.get("nomi", "—")

                if not tg_id or not kafe_id:
                    continue

                # Yangi buyurtmalarni olish
                res = supabase.table("buyurtmalar")\
                    .select("*, mijozlar(ism, telefon), buyurtma_tafsilot(soni, narx, menyular(nomi))")\
                    .eq("kafe_id", kafe_id)\
                    .eq("holat", "yangi")\
                    .order("yaratilgan", desc=True)\
                    .limit(5)\
                    .execute()

                for b in (res.data or []):
                    bid = b['id']
                    # Agar bu buyurtma allaqachon yuborilgan bo'lsa o'tkazib yuborish
                    if bid in yuborilgan_buyurtmalar:
                        continue

                    mijoz = b.get("mijozlar") or {}
                    taomlar = b.get("buyurtma_tafsilot") or []
                    taom_text = "\n".join([
                        f"  • {t.get('menyular', {}).get('nomi', '?')} ×{t.get('soni', 1)}"
                        for t in taomlar
                    ])
                    text = (
                        f"🔔 <b>Yangi buyurtma!</b>\n\n"
                        f"🆔 #{bid[:6]}\n"
                        f"👤 {mijoz.get('ism', '—')} | 📞 {mijoz.get('telefon', '—')}\n"
                        f"🍽 Taomlar:\n{taom_text}\n"
                        f"💰 Jami: {int(b.get('jami_narx', 0)):,} so'm\n"
                        f"📍 {b.get('manzil', '—')}"
                    )
                    tugma = InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(
                            text="✅ Qabul qilish",
                            callback_data=f"qabul_{bid}"
                        )]
                    ])
                    try:
                        await bot.send_message(tg_id, text, parse_mode="HTML", reply_markup=tugma)
                        yuborilgan_buyurtmalar.add(bid)
                    except Exception as e:
                        print(f"Xabar yuborishda xato: {e}")

        except Exception as e:
            print(f"Tekshirishda xato: {e}")

        await asyncio.sleep(60)


# === ISHGA TUSHIRISH ===
async def main():
    print("Bot ishga tushdi!")
    asyncio.create_task(yangi_buyurtmalarni_tekshir())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())