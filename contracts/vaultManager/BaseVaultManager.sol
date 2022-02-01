// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IERC721.sol";
import "../interfaces/IAgToken.sol";

struct VaultParameters {
    uint256 dust;
    uint256 debtCeiling;
    uint64 collateralFactor;
    uint64 targetHealthFactor;
    uint64 dustHealthFactor;
    uint64 borrowFee;
    uint64 interestRate;
    uint64 liquidationFee;
    uint64 maxLiquidationDiscount;
    uint64 liquidationBooster;
}

struct Vault {
    uint256 collateralAmount;
    uint256 normalizedDebt;
}

// TODO split in multiple files and leave some space each time for upgradeability

// solhint-disable-next-line max-states-count
abstract contract BaseVaultManager is Initializable, PausableUpgradeable, IERC721Metadata {
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using Address for address;

    event FiledUint64(uint64 param, bytes32 what);
    event FiledUint256(uint256 param, bytes32 what);
    event FiledAddress(address param, bytes32 what);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /// Mappings
    address public isWhitelisted;

    /// References to other contracts
    address public treasury;
    IERC20 public collateral;
    IAgToken public stablecoin;
    address public oracle;

    /// Parameters
    uint256 public dust;
    uint256 public debtCeiling;
    uint64 public collateralFactor;
    uint64 public targetHealthFactor;
    uint64 public dustHealthFactor;
    uint64 public borrowFee;
    uint64 public interestRate;
    uint64 public liquidationFee;
    uint64 public maxLiquidationDiscount;
    uint64 public liquidationBooster;

    /// Variables
    uint256 public lastInterestAccumulatorUpdated;
    uint256 public interestAccumulator;
    uint256 public totalBorrows;
    // Counter to generate a unique `vaultID` for each vault
    CountersUpgradeable.Counter internal _vaultIDcount;

    // ============================== ERC721 Data ==============================

    string public baseURI;

    mapping(uint256 => Vault) public vaultData;

    // Mapping from `vaultID` to owner address
    mapping(uint256 => address) internal _owners;

    // Mapping from owner address to vault owned count
    mapping(address => uint256) internal _balances;

    // Mapping from `vaultID` to approved address
    mapping(uint256 => address) internal _vaultApprovals;

    // Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) internal _operatorApprovals;


    function initialize(address _treasury, address _collateral, address _stablecoin, address _oracle, VaultParameters calldata params) public initializer {
        treasury = _treasury;
        collateral = IERC20(_collateral);
        stablecoin = IAgToken(_stablecoin);
        oracle = _oracle;
        // TODO

    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    modifier onlyGuardian {
        //TODO
        _;
    }

    modifier isLiquidable(uint256 vaultID) {
        // TODO
        _;
    }

    modifier onlyApprovedOrOwner(address caller, uint256 vaultID) {
        require(_isApprovedOrOwner(caller, vaultID), "21");
        _;
    }

    function _isLiquidable(uint256 vaultID) internal view returns(bool) {

    }

    function _getCollateralValue(uint256 amount) internal view virtual returns(uint256);

    function _handleRepay(uint256 collateralAmountToGive, uint256 stableAmountToRepay, bytes calldata data) internal {
        
    }

    function fileUint64(uint64 param, bytes32 what) external onlyGuardian {
        if (what == "collateralFactor") collateralFactor = param;
        else if (what == "targetHealthFactor") targetHealthFactor = param;
        else if (what == "dustHealthFactor") dustHealthFactor = param;
        else if (what == "borrowFee") borrowFee = param;
        else if (what == "interestRate") interestRate = param;
        else if (what == "liquidationFee") liquidationFee = param;
        else if (what == "maxLiquidationDiscount") maxLiquidationDiscount = param;
        else if (what == "liquidationBooster") liquidationBooster = param;
        emit FiledUint64(param, what);
    }

    function fileUint256(uint256 param, bytes32 what) external onlyGuardian {
        if (what == "dust") dust = param;
        else if (what == "debtCeiling") debtCeiling = param;
        emit FiledUint256(param, what);
    }

    function fileAddress(address param, bytes32 what) external onlyGuardian {
        // TODO

    }



    function createVault(uint256 collateralAmount, uint256 stablecoinAmount, address from, address toVault, address toStablecoin) external returns (uint256 vaultID){
        // TODO logic for transfer and then flash loan
        // TODO logic for fees
        _vaultIDcount.increment();
        vaultID = _vaultIDcount.current();
        vaultData[vaultID] = Vault(collateralAmount, stablecoinAmount);
        _mint(toVault, vaultID);
        collateral.safeTransferFrom(from, address(this), collateralAmount);
        stablecoin.mint(toStablecoin, stablecoinAmount);
    }

    function closeVault(uint256 vaultID, address who, bytes[] calldata call) external {
        // TODO check exact data types

    }

    function addCollateral(uint256 vaultID, uint256 collateralAmount, address from) external {

    }

    function removeCollateral(uint256 vaultID, uint256 collateralAmount, address to) external {

    }

    function repayDebt(uint256 vaultID, uint256 stablecoinAmount, address from) external {
        
    }

    function borrow(uint256 vaultID, uint256 stablecoinAmount, address to) external {

    }

    function getDebtIn(address vaultManager, uint256 vaultID) external {

    }

    function getDebtOut(uint256 vaultID) external {
        // TODO require that collateral comes from the right source
    }

    function cook(
        uint8[] calldata actions,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable {

    }

    function liquidate(uint256[] calldata vaultIDs) external {

    }

 


    function accrueInterest() external view virtual returns(uint256);

    // =============================== ERC721 Logic ================================

    /// @notice Gets the name of the NFT collection implemented by this contract
    function name() external pure override returns (string memory) {
        return "AngleVault";
    }

    /// @notice Gets the symbol of the NFT collection implemented by this contract
    function symbol() external pure override returns (string memory) {
        return "AngleVault";
    }

    /// @notice Gets the URI containing metadata
    /// @param vaultID ID of the vault
    function tokenURI(uint256 vaultID) external view override returns (string memory) {
        require(_exists(vaultID), "2");
        // There is no vault with `vaultID` equal to 0, so the following variable is
        // always greater than zero
        uint256 temp = vaultID;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (vaultID != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(vaultID % 10)));
            vaultID /= 10;
        }
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, string(buffer))) : "";
    }

    /// @notice Gets the balance of an owner
    /// @param owner Address of the owner
    /// @dev Balance here represents the number of vaults owned by a HA
    function balanceOf(address owner) external view override returns (uint256) {
        require(owner != address(0), "0");
        return _balances[owner];
    }

    /// @notice Gets the owner of the vault with ID vaultID
    /// @param vaultID ID of the vault
    function ownerOf(uint256 vaultID) external view override returns (address) {
        return _ownerOf(vaultID);
    }

    /// @notice Approves to an address specified by `to` a vault specified by `vaultID`
    /// @param to Address to approve the vault to
    /// @param vaultID ID of the vault
    /// @dev The approved address will have the right to transfer the vault, to cash it out
    /// on behalf of the owner, to add or remove collateral in it and to choose the destination
    /// address that will be able to receive the proceeds of the vault
    function approve(address to, uint256 vaultID) external override {
        address owner = _ownerOf(vaultID);
        require(to != owner, "35");
        require(msg.sender == owner || isApprovedForAll(owner, msg.sender), "21");

        _approve(to, vaultID);
    }

    /// @notice Gets the approved address by a vault owner
    /// @param vaultID ID of the concerned vault
    function getApproved(uint256 vaultID) external view override returns (address) {
        require(_exists(vaultID), "2");
        return _getApproved(vaultID);
    }

    /// @notice Sets approval on all vaults owned by the owner to an operator
    /// @param operator Address to approve (or block) on all vaults
    /// @param approved Whether the sender wants to approve or block the operator
    function setApprovalForAll(address operator, bool approved) external override {
        require(operator != msg.sender, "36");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(_msgSender(), operator, approved);
    }

    /// @notice Gets if the operator address is approved on all vaults by the owner
    /// @param owner Owner of vaults
    /// @param operator Address to check if approved
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /// @notice Gets if the sender address is approved for the vaultId
    /// @param vaultID ID of the vault
    function isApprovedOrOwner(address spender, uint256 vaultID) external view returns (bool) {
        return _isApprovedOrOwner(spender, vaultID);
    }

    /// @notice Transfers the `vaultID` from an address to another
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function transferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override onlyApprovedOrOwner(msg.sender, vaultID) {
        _transfer(from, to, vaultID);
    }

    /// @notice Safely transfers the `vaultID` from an address to another without data in it
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override {
        safeTransferFrom(from, to, vaultID, "");
    }

    /// @notice Safely transfers the `vaultID` from an address to another with data in the transfer
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) public override onlyApprovedOrOwner(msg.sender, vaultID) {
        _safeTransfer(from, to, vaultID, _data);
    }

    // =============================== ERC165 logic ================================

    /// @notice Queries if a contract implements an interface
    /// @param interfaceId The interface identifier, as specified in ERC-165
    /// @dev Interface identification is specified in ERC-165. This function uses less than 30,000 gas.
    /// Required by the ERC721 standard, so used to check that the IERC721 is implemented.
    /// @return `true` if the contract implements `interfaceID` and
    ///  `interfaceID` is not 0xffffffff, `false` otherwise
    function supportsInterface(bytes4 interfaceId) external pure override(IERC165) returns (bool) {
        return
            interfaceId == type(IERC721Metadata).interfaceId ||
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function _ownerOf(uint256 vaultID) internal view returns (address owner) {
        owner = _owners[vaultID];
        require(owner != address(0), "2");
    }

    function _getApproved(uint256 vaultID) internal view returns (address) {
        return _vaultApprovals[vaultID];
    }

    function _safeTransfer(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) internal {
        _transfer(from, to, vaultID);
        require(_checkOnERC721Received(from, to, vaultID, _data), "24");
    }

    function _exists(uint256 vaultID) internal view returns (bool) {
        return _owners[vaultID] != address(0);
    }

    function _isApprovedOrOwner(address spender, uint256 vaultID) internal view returns (bool) {
        // The following checks if the vault exists
        address owner = _ownerOf(vaultID);
        return (spender == owner || _getApproved(vaultID) == spender || _operatorApprovals[owner][spender]);
    }

    function _mint(address to, uint256 vaultID) internal {
        _balances[to] += 1;
        _owners[vaultID] = to;
        emit Transfer(address(0), to, vaultID);
        require(_checkOnERC721Received(address(0), to, vaultID, ""), "24");
    }

    function _burn(uint256 vaultID) internal {
        address owner = _ownerOf(vaultID);

        // Clear approvals
        _approve(address(0), vaultID);

        _balances[owner] -= 1;
        delete _owners[vaultID];
        delete vaultData[vaultID];

        emit Transfer(owner, address(0), vaultID);
    }

    function _transfer(
        address from,
        address to,
        uint256 vaultID
    ) internal {
        require(_ownerOf(vaultID) == from, "1");
        require(to != address(0), "26");

        // Clear approvals from the previous owner
        _approve(address(0), vaultID);

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[vaultID] = to;

        emit Transfer(from, to, vaultID);
    }

    function _approve(address to, uint256 vaultID) internal {
        _vaultApprovals[vaultID] = to;
        emit Approval(_ownerOf(vaultID), to, vaultID);
    }

    function _checkOnERC721Received(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) private returns (bool) {
        if (to.isContract()) {
            try IERC721ReceiverUpgradeable(to).onERC721Received(msg.sender, from, vaultID, _data) returns (
                bytes4 retval
            ) {
                return retval == IERC721ReceiverUpgradeable(to).onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("24");
                } else {
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }



}