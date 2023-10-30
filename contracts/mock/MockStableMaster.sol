// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../interfaces/IAgToken.sol";
import "./MockToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SLPData, MintBurnData } from "../interfaces/coreModule/IStableMaster.sol";

// All the details about a collateral that are going to be stored in `StableMaster`
struct Collateral {
    // Interface for the token accepted by the underlying `PoolManager` contract
    IERC20 token;
    // Reference to the `SanToken` for the pool
    MockToken sanToken;
    // Reference to the `PerpetualManager` for the pool
    address perpetualManager;
    // Adress of the oracle for the change rate between
    // collateral and the corresponding stablecoin
    address oracle;
    // Amount of collateral in the reserves that comes from users
    // converted in stablecoin value. Updated at minting and burning.
    // A `stocksUsers` of 10 for a collateral type means that overall the balance of the collateral from users
    // that minted/burnt stablecoins using this collateral is worth 10 of stablecoins
    uint256 stocksUsers;
    // Exchange rate between sanToken and collateral
    uint256 sanRate;
    // Base used in the collateral implementation (ERC20 decimal)
    uint256 collatBase;
    // Parameters for SLPs and update of the `sanRate`
    SLPData slpData;
    // All the fees parameters
    MintBurnData feeData;
}

contract MockStableMaster {
    mapping(address => uint256) public poolManagerMap;

    constructor() {}

    function updateStocksUsers(uint256 amount, address poolManager) external {
        poolManagerMap[poolManager] += amount;
    }

    function burnSelf(IAgToken agToken, uint256 amount, address burner) external {
        agToken.burnSelf(amount, burner);
    }

    function burnFrom(IAgToken agToken, uint256 amount, address burner, address sender) external {
        agToken.burnFrom(amount, burner, sender);
    }

    function mint(IAgToken agToken, address account, uint256 amount) external {
        agToken.mint(account, amount);
    }
}

contract MockStableMasterSanWrapper is MockStableMaster {
    using SafeERC20 for IERC20;

    /// @notice Maps a `PoolManager` contract handling a collateral for this stablecoin to the properties of the struct above
    mapping(address => Collateral) public collateralMap;

    constructor() MockStableMaster() {}

    uint256 internal constant _BASE_TOKENS = 10 ** 18;
    uint256 internal constant _BASE_PARAMS = 10 ** 9;
    IERC20 public token;

    function deposit(uint256 assets, address receiver, address poolManager) external {
        token.safeTransferFrom(msg.sender, address(this), assets);
        Collateral storage col = collateralMap[poolManager];
        _updateSanRate(col);
        uint256 amount = (assets * _BASE_TOKENS) / col.sanRate;
        col.sanToken.mint(receiver, amount);
    }

    function withdraw(uint256 assets, address sender, address receiver, address poolManager) external {
        Collateral storage col = collateralMap[poolManager];
        _updateSanRate(col);
        col.sanToken.burn(sender, assets);
        // Computing the amount of collateral to give back to the SLP depending on slippage and on the `sanRate`
        uint256 redeemInC = (assets * (_BASE_PARAMS - col.slpData.slippage) * col.sanRate) /
            (_BASE_TOKENS * _BASE_PARAMS);
        token.safeTransfer(receiver, redeemInC);
    }

    function setPoolManagerToken(address, address token_) external {
        token = MockToken(token_);
    }

    function setPoolManagerSanToken(address poolManager, address sanToken_) external {
        Collateral storage col = collateralMap[poolManager];
        col.sanToken = MockToken(sanToken_);
    }

    function setSanRate(address poolManager, uint256 sanRate_) external {
        Collateral storage col = collateralMap[poolManager];
        col.sanRate = sanRate_;
    }

    function _updateSanRate(Collateral storage col) internal {
        uint256 _lockedInterests = col.slpData.lockedInterests;
        // Checking if the `sanRate` has been updated in the current block using past block fees
        // This is a way to prevent flash loans attacks when an important amount of fees are going to be distributed
        // in a block: fees are stored but will just be distributed to SLPs who will be here during next blocks
        if (block.timestamp != col.slpData.lastBlockUpdated && _lockedInterests > 0) {
            uint256 sanMint = col.sanToken.totalSupply();
            if (sanMint != 0) {
                // Checking if the update is too important and should be made in multiple blocks
                if (_lockedInterests > col.slpData.maxInterestsDistributed) {
                    // `sanRate` is expressed in `BASE_TOKENS`
                    col.sanRate += (col.slpData.maxInterestsDistributed * 10 ** 18) / sanMint;
                    _lockedInterests -= col.slpData.maxInterestsDistributed;
                } else {
                    col.sanRate += (_lockedInterests * 10 ** 18) / sanMint;
                    _lockedInterests = 0;
                }
            } else {
                _lockedInterests = 0;
            }
        }
        col.slpData.lockedInterests = _lockedInterests;
        col.slpData.lastBlockUpdated = block.timestamp;
    }

    // copy paste from the deployed contract
    function estimateSanRate(address poolManager) external view returns (uint256 sanRate, uint64 slippage) {
        Collateral memory col = collateralMap[poolManager];
        uint256 _lockedInterests = col.slpData.lockedInterests;
        // Checking if the `sanRate` has been updated in the current block using past block fees
        // This is a way to prevent flash loans attacks when an important amount of fees are going to be distributed
        // in a block: fees are stored but will just be distributed to SLPs who will be here during next blocks
        if (block.timestamp != col.slpData.lastBlockUpdated && _lockedInterests > 0) {
            uint256 sanMint = col.sanToken.totalSupply();
            if (sanMint != 0) {
                // Checking if the update is too important and should be made in multiple blocks
                if (_lockedInterests > col.slpData.maxInterestsDistributed) {
                    // `sanRate` is expressed in `BASE_TOKENS`
                    col.sanRate += (col.slpData.maxInterestsDistributed * 10 ** 18) / sanMint;
                    _lockedInterests -= col.slpData.maxInterestsDistributed;
                } else {
                    col.sanRate += (_lockedInterests * 10 ** 18) / sanMint;
                    _lockedInterests = 0;
                }
            } else {
                _lockedInterests = 0;
            }
        }
        return (col.sanRate, col.slpData.slippage);
    }

    function setSLPData(
        address poolManager,
        uint256 lockedInterests,
        uint256 maxInterestsDistributed,
        uint64 slippage
    ) external {
        Collateral storage col = collateralMap[poolManager];
        col.slpData.lockedInterests = lockedInterests;
        col.slpData.maxInterestsDistributed = maxInterestsDistributed;
        col.slpData.slippage = slippage;
    }
}
