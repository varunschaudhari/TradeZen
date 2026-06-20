"""
File: universe.py
Description: Static NSE stock universe — index constituent lists for the Step 2
             screener (Nifty 50 + Nifty Next 50 + Midcap 150 + Smallcap 100).
             Each symbol carries a tier tag used as a market-cap proxy.
Author: SwingTrader AI Team
Created: 2026-06-19
Last Modified: 2026-06-19

NOTE: These are curated constituent lists. Index membership drifts over time —
refresh from the official NSE index factsheets periodically. Unknown or delisted
symbols are handled gracefully by the screener (skipped, logged), so a slightly
stale list never breaks a scan.
"""

import logging

from app.config import MARKET_CAP_TIERS

logger = logging.getLogger(__name__)

# Symbols are bare NSE tickers (no .NS suffix); data_fetcher appends NSE_SUFFIX.

NIFTY50: list[str] = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
    "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT", "GRASIM",
    "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO", "HINDALCO",
    "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY", "ITC",
    "JIOFIN", "JSWSTEEL", "KOTAKBANK", "LT", "M&M",
    "MARUTI", "NESTLEIND", "NTPC", "ONGC", "POWERGRID",
    "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA",
    "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM",
    "TITAN", "TRENT", "ULTRACEMCO", "WIPRO",
]

NEXT50: list[str] = [
    "ABB", "ADANIENSOL", "ADANIGREEN", "ADANIPOWER", "AMBUJACEM",
    "BANKBARODA", "BERGEPAINT", "BPCL", "BOSCHLTD", "CANBK",
    "CHOLAFIN", "COLPAL", "DABUR", "DLF", "DIVISLAB",
    "GAIL", "GODREJCP", "HAVELLS", "HAL", "ICICIGI",
    "ICICIPRULI", "INDIGO", "IOC", "IRFC", "JINDALSTEL",
    "LICI", "LODHA", "MARICO", "MOTHERSON", "NAUKRI",
    "PIDILITIND", "PFC", "PNB", "RECLTD", "SIEMENS",
    "SRF", "TVSMOTOR", "TORNTPHARM", "VBL", "VEDL",
    "ZOMATO", "ZYDUSLIFE", "GODREJPROP", "AMBUJACEM", "INDHOTEL",
    "MAXHEALTH", "MUTHOOTFIN", "POLYCAB", "UNITDSPR", "CGPOWER",
]

MIDCAP150: list[str] = [
    "ACC", "ABCAPITAL", "ABFRL", "ALKEM", "ASHOKLEY",
    "ASTRAL", "AUBANK", "AUROPHARMA", "BALKRISIND", "BANDHANBNK",
    "BHARATFORG", "BHEL", "BIOCON", "COFORGE", "CONCOR",
    "COROMANDEL", "CUMMINSIND", "DALBHARAT", "DEEPAKNTR", "DIXON",
    "ESCORTS", "EXIDEIND", "FEDERALBNK", "GLENMARK", "GMRINFRA",
    "GODREJIND", "GUJGASLTD", "HINDPETRO", "IDFCFIRSTB", "INDUSTOWER",
    "IPCALAB", "JUBLFOOD", "LTF", "LTTS", "LUPIN",
    "MFSL", "MPHASIS", "MRF", "NMDC", "OBEROIRLTY",
    "OFSS", "PAGEIND", "PERSISTENT", "PETRONET", "PIIND",
    "PRESTIGE", "SAIL", "SHREECEM", "SUNTV", "SUPREMEIND",
    "SYNGENE", "TATACOMM", "TATAELXSI", "TATAPOWER", "TIINDIA",
    "TORNTPOWER", "UPL", "VOLTAS", "YESBANK", "ZEEL",
    "APLAPOLLO", "AARTIIND", "BATAINDIA", "CASTROLIND", "CROMPTON",
    "CANFINHOME", "CHAMBLFERT", "CESC", "EMAMILTD", "FORTIS",
    "GODFRYPHLP", "GRANULES", "HONAUT", "IDEA", "INDIAMART",
    "IRCTC", "JKCEMENT", "KPITTECH", "LAURUSLABS", "MANAPPURAM",
    "MGL", "NATIONALUM", "NAVINFLUOR", "PEL", "POLICYBZR",
    "RAMCOCEM", "RBLBANK", "SUNDARMFIN", "TRIDENT", "WHIRLPOOL",
]

SMALLCAP100: list[str] = [
    "AAVAS", "ABSLAMC", "ACE", "AEGISLOG", "AFFLE",
    "AMBER", "ANGELONE", "APARINDS", "BLUESTARCO", "BSE",
    "CDSL", "CEATLTD", "CENTURYPLY", "CERA", "CHENNPETRO",
    "CYIENT", "DBL", "ELGIEQUIP", "ENGINERSIN", "EIHOTEL",
    "FINEORG", "FINPIPE", "FSL", "GESHIP", "GPPL",
    "GRINDWELL", "GSPL", "HFCL", "IIFL", "INTELLECT",
    "JBCHEPHARM", "JKLAKSHMI", "JKPAPER", "JMFINANCIL", "JYOTHYLAB",
    "KAJARIACER", "KARURVYSYA", "KEC", "KIRLOSENG", "KSB",
    "LXCHEM", "MAHSEAMLES", "MASTEK", "MEDPLUS", "METROPOLIS",
    "MMTC", "NATCOPHARM", "NBCC", "NCC", "NH",
    "PNBHOUSING", "PVRINOX", "RADICO", "RAILTEL", "RAJESHEXPO",
    "RATNAMANI", "RAYMOND", "REDINGTON", "RHIM", "ROUTE",
    "SCHAEFFLER", "SHYAMMETL", "SOBHA", "SONACOMS", "SPARC",
    "STARHEALTH", "SUMICHEM", "SUNDRMFAST", "SWANENERGY", "SYRMA",
    "TANLA", "TEJASNET", "TITAGARH", "TRITURBINE", "TTML",
    "UCOBANK", "UJJIVANSFB", "USHAMART", "UTIAMC", "VGUARD",
    "VINATIORGA", "WELCORP", "WELSPUNLIV", "ZENSARTECH", "ZFCVINDIA",
]

_TIER_LISTS: dict[str, list[str]] = {
    "NIFTY50": NIFTY50,
    "NEXT50": NEXT50,
    "MIDCAP150": MIDCAP150,
    "SMALLCAP100": SMALLCAP100,
}


def get_universe(tiers: tuple[str, ...] = MARKET_CAP_TIERS) -> dict[str, str]:
    """
    Build the symbol → tier map for the requested index tiers.

    Tiers are processed largest-cap first (NIFTY50 → SMALLCAP100); when the same
    symbol appears in more than one list, the highest-cap tier wins. This makes the
    tier tag a stable market-cap proxy for screening pre-filter 2.

    Args:
        tiers: Index tiers to include (subset of MARKET_CAP_TIERS)

    Returns:
        Ordered dict mapping bare NSE symbol -> tier label (deduplicated)
    """
    universe: dict[str, str] = {}
    for tier in MARKET_CAP_TIERS:  # iterate in fixed cap order, not request order
        if tier not in tiers:
            continue
        for symbol in _TIER_LISTS.get(tier, []):
            if symbol not in universe:  # first (highest-cap) tier wins
                universe[symbol] = tier
    logger.info("Universe built: %d symbols across tiers=%s", len(universe), list(tiers))
    return universe


def list_symbols(tiers: tuple[str, ...] = MARKET_CAP_TIERS) -> list[str]:
    """
    Return the deduplicated list of bare NSE symbols for the requested tiers.

    Args:
        tiers: Index tiers to include

    Returns:
        List of unique symbols
    """
    return list(get_universe(tiers).keys())
